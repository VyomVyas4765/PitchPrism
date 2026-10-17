import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Field-level protection for applicant personal data (PRD section 21, contracts Encrypted type).
// One configured secret; separate derived keys for encryption and for duplicate-matching hashes.
const VERSION = 1;
const derive = (secret: string, purpose: string) => Buffer.from(hkdfSync('sha256', secret, 'pitchprism', purpose, 32));
const b64 = (value: Buffer) => value.toString('base64url');

export type ContactKind = 'phone' | 'email';
export interface DataCrypto {
  /** context binds ciphertext to its field (for example "entrepreneur.phone") so values cannot be swapped between fields. */
  encrypt(plain: string, context: string): string;
  decrypt(token: string, context: string): string;
  contactHash(value: string, kind: ContactKind): string;
}

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

export function dataCrypto(secret: string): DataCrypto {
  if (secret.length < 32) throw new Error('DATA_ENCRYPTION_KEY must be at least 32 characters');
  const encKey = derive(secret, `pii-encryption-v${VERSION}`);
  const macKey = derive(secret, 'contact-hash-v1');
  return {
    encrypt(plain, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return `v${VERSION}:${b64(iv)}:${b64(cipher.getAuthTag())}:${b64(data)}`;
    },
    decrypt(token, context) {
      const match = /^v(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]*)$/.exec(token);
      if (!match || Number(match[1]) !== VERSION) throw new Error('Unsupported encrypted value');
      const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(match[2]!, 'base64url'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(match[3]!, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(match[4]!, 'base64url')), decipher.final()]).toString('utf8');
    },
    contactHash(value, kind) {
      return createHmac('sha256', macKey).update(`${kind}:${normaliseContact(value, kind)}`).digest('hex');
    },
  };
}

/** Constant-time comparison for hex digests (invitation tokens). */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
