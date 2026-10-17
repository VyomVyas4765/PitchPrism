// Launch languages and consent labels used by the entrepreneur module.
export const LANGUAGES = ['hi', 'mr', 'te', 'or', 'bn', 'en'] as const;
export type Language = typeof LANGUAGES[number];
export const GENDERS = ['female', 'male', 'other', 'prefer_not_to_say'] as const;
export const INDIAN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep'] as const;
export const SHARING_SCOPES = ['sector_partner', 'funding_partner'] as const;
export type SharingScope = typeof SHARING_SCOPES[number];
export const CONSENT_NOTICE_VERSION = 'consent-notice-2026-10-17';
export const CONSENT_NOTICE_VERSIONS = [CONSENT_NOTICE_VERSION] as const;

// D-28: use Dev 3's contract-backed models. Registering a second Mongoose model breaks startup.
export { Consent, Entrepreneur } from '../../models.js';
