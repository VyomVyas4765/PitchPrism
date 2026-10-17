// Launch languages (PRD §6). Mirrors ai/capabilities.json and the shared Language contract.
export const LANGUAGES = ['hi', 'mr', 'te', 'or', 'bn', 'en'] as const;
export type Language = typeof LANGUAGES[number];
export const GENDERS = ['female', 'male', 'other', 'prefer_not_to_say'] as const;
export const SHARING_SCOPES = ['sector_partner', 'funding_partner'] as const;
export type SharingScope = typeof SHARING_SCOPES[number];
// The consent notice text shown in the app carries this version; records store what was shown.
export const CONSENT_NOTICE_VERSION = 'consent-notice-2026-10-17';
export const CONSENT_NOTICE_VERSIONS = [CONSENT_NOTICE_VERSION] as const;

// PRD §19 `entrepreneurs` and `consents`. The models are defined once, from the shared contracts
// (packages/contracts/schemas/domain/entrepreneur.json and consent.json, D-28), and re-exported here so
// this module's imports keep working. For phone sign-in, an Entrepreneur _id equals the User _id.
export { Consent, Entrepreneur } from '../../models.js';
