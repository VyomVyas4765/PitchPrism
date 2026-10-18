// Funding opportunities for the entrepreneur's "My ideas" dashboard: public schemes and bank routes in India that a
// small new business can apply to, ranked for this idea (loan needed, state, gender, trade). Terms change: every
// entry names the official website and the person is told to confirm current terms there or at the bank. Last
// reviewed 2026-10-18 by the development team; review before any real-user release.

export interface FundingContext { loan: number | null; investment: number | null; state: string | null; gender: string | null; business: string }
export interface FundingOption {
  id: string; name: string; kind: 'loan' | 'subsidy' | 'support' | 'registration'; provider: string;
  summary: string; amount: string; who: string; howToApply: string; website: string;
  fit: 'good' | 'possible' | 'other'; why: string;
}
type Entry = Omit<FundingOption, 'fit' | 'why'> & { match: (c: FundingContext) => { fit: FundingOption['fit']; why: string } };

const lakh = (value: number) => value >= 100000 ? `₹${(value / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh` : `₹${value.toLocaleString('en-IN')}`;
const need = (c: FundingContext) => c.loan ?? (c.investment ? c.investment : null);
const has = (c: FundingContext, words: string[]) => words.some(word => c.business.toLowerCase().includes(word));
// PM Vishwakarma's 18 traditional trades (by the words people use for them).
const ARTISAN = ['tailor', 'stitch', 'darzi', 'carpent', 'potter', 'pottery', 'cobbler', 'shoe', 'barber', 'salon', 'washer', 'laundry', 'dhobi',
  'blacksmith', 'goldsmith', 'jewel', 'mason', 'basket', 'mat ', 'broom', 'toy', 'doll', 'garland', 'locksmith', 'sculpt', 'stone', 'fishing net', 'boat', 'armour'];
const VENDOR = ['street', 'vendor', 'hawker', 'cart', 'stall', 'thela', 'food stall'];

const CATALOGUE: Entry[] = [
  { id: 'mudra', name: 'Pradhan Mantri MUDRA Yojana (PMMY)', kind: 'loan', provider: 'Government of India, through banks, RRBs, small finance banks and MFIs',
    summary: 'Collateral-free loans for small non-farm businesses: Shishu (up to ₹50,000), Kishore (above ₹50,000 up to ₹5 lakh) and Tarun (above ₹5 lakh up to ₹10 lakh).',
    amount: 'Up to ₹10 lakh (Tarun Plus up to ₹20 lakh for those who repaid a Tarun loan)', who: 'Anyone starting or growing a small manufacturing, trading or service business.',
    howToApply: 'Ask any bank branch, regional rural bank or microfinance institution for a MUDRA loan, or apply online on the JanSamarth portal (jansamarth.in). Take your business plan, ID and address proof.',
    website: 'https://www.mudra.org.in',
    match: c => { const n = need(c); if (n === null) return { fit: 'good', why: 'Most small first businesses start with a MUDRA loan.' };
      const band = n <= 50000 ? 'Shishu' : n <= 500000 ? 'Kishore' : n <= 1000000 ? 'Tarun' : null;
      return band ? { fit: 'good', why: `Your plan needs about ${lakh(n)}: that fits a MUDRA ${band} loan.` } : { fit: 'possible', why: `Your plan needs about ${lakh(n)}, above the usual MUDRA limit; it can cover part of it.` }; } },
  { id: 'pmegp', name: 'PM Employment Generation Programme (PMEGP)', kind: 'subsidy', provider: 'KVIC, State KVIBs and District Industries Centres, with banks',
    summary: 'A bank loan for a new business where the government pays part of the project cost as a subsidy (margin money), about 15% to 35% depending on area and category.',
    amount: 'Project cost up to ₹50 lakh (manufacturing) or ₹20 lakh (service/business)', who: 'Adults (18+) starting a NEW business; you put in 5% to 10% yourself. Some education rules apply to bigger projects.',
    howToApply: 'Apply online on the PMEGP e-portal; your application goes to the bank through KVIC, KVIB or the District Industries Centre.',
    website: 'https://www.kviconline.gov.in/pmegpeportal',
    match: c => { const n = c.investment ?? need(c);
      return n !== null && n >= 100000 ? { fit: 'good', why: `A new business with a project of about ${lakh(n)} can get a subsidy on part of the cost.` }
        : { fit: 'possible', why: 'Good for a new business; most useful when the project cost is above ₹1 lakh.' }; } },
  { id: 'vishwakarma', name: 'PM Vishwakarma', kind: 'loan', provider: 'Government of India (Ministry of MSME), through banks',
    summary: 'For traditional artisans and craftspeople in 18 trades (tailor, carpenter, potter, cobbler, barber and more): skill training with a stipend, a toolkit incentive and low-interest collateral-free loans.',
    amount: 'Loans of ₹1 lakh, then ₹2 lakh, at a concessional interest rate; toolkit incentive up to ₹15,000', who: 'Artisans working with their hands in one of the 18 listed trades, registered through the scheme.',
    howToApply: 'Register at a Common Service Centre (CSC) with Aadhaar and mobile; the gram panchayat or urban local body verifies you.',
    website: 'https://pmvishwakarma.gov.in',
    match: c => has(c, ARTISAN) ? { fit: 'good', why: 'Your business is in one of the traditional trades this scheme supports.' } : { fit: 'other', why: 'Only for the 18 traditional artisan trades.' } },
  { id: 'standup', name: 'Stand-Up India', kind: 'loan', provider: 'Scheduled commercial banks (SIDBI portal)',
    summary: 'Bank loans for a new (greenfield) business in manufacturing, services, trading or agri-allied activities, for women and SC/ST entrepreneurs.',
    amount: '₹10 lakh to ₹1 crore', who: 'Women entrepreneurs, or SC/ST entrepreneurs, starting their first business of this kind.',
    howToApply: 'Apply on the Stand-Up Mitra portal or at a bank branch; handholding support is available through the portal.',
    website: 'https://www.standupmitra.in',
    match: c => { const n = need(c);
      if (n !== null && n < 1000000) return { fit: 'other', why: `For loans of ₹10 lakh and above; your plan needs about ${lakh(n)}.` };
      return c.gender === 'female' ? { fit: 'good', why: 'You are a woman starting a new business, which this scheme is for.' } : { fit: 'possible', why: 'For women and SC/ST entrepreneurs with larger projects.' }; } },
  { id: 'svanidhi', name: 'PM SVANidhi', kind: 'loan', provider: 'Ministry of Housing and Urban Affairs, through banks and MFIs',
    summary: 'Small working-capital loans for street vendors, given in stages; repaying on time unlocks the next, bigger loan, with an interest subsidy and digital-payment cashback.',
    amount: 'Small loans in increasing stages', who: 'Street vendors in towns and cities.',
    howToApply: 'Apply on the PM SVANidhi portal, at a CSC, or through your urban local body.',
    website: 'https://pmsvanidhi.mohua.gov.in',
    match: c => has(c, VENDOR) ? { fit: 'good', why: 'Your business sells on the street or from a stall.' } : { fit: 'other', why: 'Only for street vendors.' } },
  { id: 'nrlm', name: 'Self-Help Group bank loans (DAY-NRLM)', kind: 'support', provider: 'State Rural Livelihoods Missions, through banks',
    summary: 'Women in village Self-Help Groups can get bank loans through their group and support to start small businesses.',
    amount: 'Depends on the group and the bank', who: 'Women in rural areas who are (or join) members of a Self-Help Group.',
    howToApply: 'Contact your village Self-Help Group, the block office of the State Rural Livelihoods Mission, or the gram panchayat.',
    website: 'https://aajeevika.gov.in',
    match: c => c.gender === 'female' ? { fit: 'possible', why: 'Useful if you live in a village and are in, or can join, a Self-Help Group.' } : { fit: 'other', why: 'For women in rural Self-Help Groups.' } },
  { id: 'cmegp', name: "Chief Minister's Employment Generation Programme (CMEGP), Maharashtra", kind: 'subsidy', provider: 'Government of Maharashtra, through DIC/KVIB and banks',
    summary: "Maharashtra's scheme for new small businesses: a bank loan with part of the project cost given as a subsidy.",
    amount: 'Depends on project and category; see the portal', who: 'Residents of Maharashtra starting a new business.',
    howToApply: 'Apply online on the CMEGP portal; the District Industries Centre guides you.',
    website: 'https://maha-cmegp.gov.in',
    match: c => c.state === 'Maharashtra' ? { fit: 'good', why: 'You are starting a new business in Maharashtra.' } : { fit: 'other', why: 'Only in Maharashtra.' } },
  { id: 'dic', name: 'District Industries Centre (DIC)', kind: 'support', provider: 'Your state government',
    summary: 'The DIC in your district explains your state\'s own business schemes and subsidies and helps you prepare loan applications.',
    amount: 'Advice and state schemes', who: 'Anyone starting a small business in the district.',
    howToApply: 'Visit the District Industries Centre at your district headquarters with your business plan.',
    website: 'https://msme.gov.in',
    match: c => ({ fit: 'possible', why: c.state ? `Ask about ${c.state}'s own schemes for new businesses.` : 'Ask about your state\'s own schemes for new businesses.' }) },
  { id: 'cgtmse', name: 'Credit Guarantee for small businesses (CGTMSE)', kind: 'support', provider: 'Government of India and SIDBI, used by banks',
    summary: 'A government guarantee that lets banks lend to small businesses without asking for collateral or a guarantor.',
    amount: 'Covers collateral-free bank loans to micro and small enterprises', who: 'Micro and small businesses taking a bank loan.',
    howToApply: 'You do not apply yourself: ask your bank to cover your loan under CGTMSE so no collateral is needed.',
    website: 'https://www.cgtmse.in',
    match: c => { const n = need(c); return n !== null && n > 50000 ? { fit: 'possible', why: 'Ask the bank for this so your loan needs no collateral.' } : { fit: 'other', why: 'Matters for bigger bank loans.' }; } },
  { id: 'udyam', name: 'Udyam Registration (free MSME registration)', kind: 'registration', provider: 'Ministry of MSME',
    summary: 'A free online registration that proves your business is a micro or small enterprise; many loans and schemes ask for it.',
    amount: 'Free', who: 'Every small business (needs Aadhaar).',
    howToApply: 'Register yourself online on the Udyam portal; it is free. Do not pay agents.',
    website: 'https://udyamregistration.gov.in',
    match: () => ({ fit: 'good', why: 'Do this first: banks and schemes often ask for your Udyam number.' }) },
];

export function fundingOptions(context: FundingContext): FundingOption[] {
  const rank = { good: 0, possible: 1, other: 2 } as const;
  return CATALOGUE.map(({ match, ...entry }) => ({ ...entry, ...match(context) }))
    .sort((a, b) => rank[a.fit] - rank[b.fit]);
}

export const FUNDING_NOTE = 'Amounts and rules change. Always confirm current terms on the official website or at the bank, and never pay an agent to apply.';
