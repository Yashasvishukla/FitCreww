// @fitcrew/application root barrel. Prefer importing a specific module's
// subpath export (e.g. '@fitcrew/application/money') over this file, so
// module boundaries stay visible at the import site.

export { IDENTITY_ACCESS_MODULE } from './identity-access/index.js';
export { NETWORK_MODULE } from './network/index.js';
export { CLIENT_LIFECYCLE_MODULE } from './client-lifecycle/index.js';
export { MONEY_MODULE } from './money/index.js';
export { MEDIA_MODULE } from './media/index.js';
export { PLATFORM_MODULE } from './platform/index.js';
export { NOTIFICATIONS_MODULE } from './notifications/index.js';
