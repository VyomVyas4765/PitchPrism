import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { HttpError } from '../errors.js';
export interface PhoneIdentity { uid: string; phone: string }
export type VerifyPhoneToken = (token: string) => Promise<PhoneIdentity>;
export function firebasePhoneVerifier(projectId: string): VerifyPhoneToken {
  return async (token) => {
    if (!projectId) throw new HttpError(503, 'Phone sign-in is not configured yet.');
    const app = getApps()[0] ?? initializeApp({ projectId, credential: applicationDefault() });
    try {
      const decoded = await getAuth(app).verifyIdToken(token, true);
      if (decoded.firebase.sign_in_provider !== 'phone' || !decoded.phone_number) throw new Error('Phone sign-in required');
      return { uid: decoded.uid, phone: decoded.phone_number };
    } catch { throw new HttpError(401, 'Phone verification failed. Please sign in again.'); }
  };
}
