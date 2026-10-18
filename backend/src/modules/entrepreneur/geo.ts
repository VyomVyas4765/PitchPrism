import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { requirePermission } from '../../auth/authorization.js';

// Location auto-suggest for the application form. The app asks this route, never a third party directly, so the
// phone's address is not shared and the lookup can be swapped or taken offline in one place. Only the place text
// the person types is sent on; no account, name or phone number leaves the server.
// 6-digit pincode -> India Post; anything else -> OpenStreetMap Nominatim (usage policy: one request a second,
// identifying User-Agent, results cached, no per-keystroke calls from the app).
export interface PlaceSuggestion { label: string; village: string; block: string; district: string; state: string; pincode: string }

const USER_AGENT = 'PitchPrism/1.0 (location suggest)';
const TIMEOUT_MS = 6000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; items: PlaceSuggestion[] }>();
let lastRemote = 0;

const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const first = (...values: unknown[]) => values.map(clean).find(Boolean) ?? '';
const unique = (items: PlaceSuggestion[]) => {
  const seen = new Set<string>();
  return items.filter(item => { const key = item.label.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
};
const describe = (item: Omit<PlaceSuggestion, 'label'>): PlaceSuggestion => ({
  ...item, label: [item.village, item.block !== item.village ? item.block : '', item.district, item.state, item.pincode].filter(Boolean).join(', '),
});

async function remote(url: string) {
  // Nominatim allows one request a second; serialise politely instead of failing the person's typing.
  const wait = lastRemote + 1100 - Date.now();
  lastRemote = Math.max(Date.now(), lastRemote) + (wait > 0 ? wait : 0);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`geo upstream ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function byPincode(pincode: string): Promise<PlaceSuggestion[]> {
  const data = await remote(`https://api.postalpincode.in/pincode/${pincode}`) as { PostOffice?: Record<string, string>[] | null }[];
  const offices = data?.[0]?.PostOffice ?? [];
  return unique(offices.map(office => describe({ village: clean(office.Name), block: first(office.Block, office.Division), district: clean(office.District),
    state: clean(office.State), pincode: clean(office.Pincode) })));
}

async function byName(query: string): Promise<PlaceSuggestion[]> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, countrycodes: 'in', format: 'jsonv2', addressdetails: '1', limit: '8', 'accept-language': 'en' })}`;
  const data = await remote(url) as { address?: Record<string, string> }[];
  return unique((Array.isArray(data) ? data : []).flatMap(row => {
    const a = row.address ?? {};
    const village = first(a.village, a.hamlet, a.suburb, a.neighbourhood, a.town, a.city_district, a.city);
    const district = first(a.state_district, a.county, a.city);
    const state = clean(a.state);
    if (!village || !district || !state) return [];
    return [describe({ village, block: first(a.county, a.municipality, a.subdistrict, a.town, a.city_district).replace(/ (Sub)?district$/i, ''), district: district.replace(/ district$/i, ''),
      state, pincode: /^[1-9]\d{5}$/.test(clean(a.postcode)) ? clean(a.postcode) : '' })];
  }));
}

export function geoRouter() {
  const router = Router();
  router.get('/geo/suggest', requirePermission('submit_own'), async (req, res) => {
    const q = z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N}\s.,'()-]+$/u).safeParse(req.query.q);
    if (!q.success) throw new HttpError(400, 'Type at least two letters of the place or its pincode.');
    const key = q.data.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) { res.json({ suggestions: hit.items }); return; }
    try {
      const items = /^[1-9]\d{5}$/.test(q.data) ? await byPincode(q.data) : await byName(q.data);
      if (cache.size > 500) cache.clear();
      cache.set(key, { at: Date.now(), items });
      res.json({ suggestions: items.slice(0, 8) });
    } catch {
      // Suggestions are a convenience: the person can always type the fields by hand.
      res.json({ suggestions: [], unavailable: true });
    }
  });
  return router;
}
