// Notifications module public barrel (Architecture §11, §12).
// Owns: the NotificationChannel port + adapters (email day-one; SMS/WhatsApp
// later), driven purely by domain event handlers. Only this file is importable
// from outside this folder. Landing starting Level 3.3.

export const NOTIFICATIONS_MODULE = 'notifications';
