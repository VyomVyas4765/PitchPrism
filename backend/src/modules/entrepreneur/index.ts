// Public surface of the entrepreneur module (Dev 1). Other roles import consent checks from here.
export { entrepreneurRouter } from './router.js';
export { hasProcessingConsent, sharingAllowed } from './consent.js';
export { LANGUAGES, SHARING_SCOPES, type Language, type SharingScope } from './models.js';
