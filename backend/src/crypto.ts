import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

// Duplicate-matching helpers for applicant contacts (PRD section 12, D-14). Personal fields themselves are
// sealed by the entrepreneur PII vault (modules/entrepreneur/pii-vault.ts); the hash key is derived from the
// same PII_ENCRYPTION_KEY with a separate purpose label, so one secret covers both.
export type ContactKind = 'phone' | 'email';

export function normaliseContact(value: string, kind: ContactKind): string {
  if (kind === 'email') return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const PLACEHOLDER_EMAIL = /@(demo\.com|example\.(com|org|net)|test|invalid|localhost)$/i;
/** Known dummy contacts (for example 9000000080 or @demo.com) are excluded from duplicate matching (PRD section 12). */
export function isPlaceholderContact(value: string, kind: ContactKind): boolean {
  const normal = normaliseContact(value, kind);
  if (kind === 'email') return PLACEHOLDER_EMAIL.test(normal);
  return normal.length < 10 || /^(\d)\1{9}$/.test(normal) || /^9000000\d{3}$/.test(normal) || ['1234567890', '9876543210', '0123456789'].includes(normal);
}

/** Keyed hash of a normalised contact. Returns null when PII_ENCRYPTION_KEY is unset (profile storage disabled). */
export function contactHasher(piiKeyHex: string) {
  if (!/^[a-f\d]{64}$/i.test(piiKeyHex)) return null;
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(piiKeyHex, 'hex'), 'pitchprism', 'contact-hash-v1', 32));
  return (value: string, kind: ContactKind) => createHmac('sha256', key).update(`${kind}:${normaliseContact(value, kind)}`).digest('hex');
}

/** Constant-time comparison for hex digests (invitation tokens). */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
