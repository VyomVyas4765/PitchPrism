import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpError } from '../../errors.js';

// A-10 vault: personal fields are sealed at rest and bound to their record ID, so a
// ciphertext copied onto another record fails authentication instead of decrypting.
export interface Sealed { v: 1; iv: string; tag: string; ct: string }
export interface PiiVault {
  seal(value: unknown, recordId: string): Sealed;
  open<T>(sealed: Sealed, recordId: string): T;
}

export function piiVault(hexKey: string): PiiVault | null {
  if (!/^[a-f\d]{64}$/i.test(hexKey)) return null;
  const key = Buffer.from(hexKey, 'hex');
  return {
    seal(value, recordId) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(recordId));
      const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
    },
    open(sealed, recordId) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
        decipher.setAAD(Buffer.from(recordId));
        decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
        const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]);
        return JSON.parse(plain.toString('utf8'));
      } catch {
        // Never surface ciphertext or key details; a changed key makes stored profiles unreadable.
        throw new HttpError(503, 'Stored profile details cannot be read on this server.');
      }
    },
  };
}
