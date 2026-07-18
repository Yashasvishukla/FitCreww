import pino from 'pino';

// Companion Node worker process (Architecture §4, §12) — the one thing Next.js
// has no runtime for. Scheduled jobs (evaluation due-dates, subscription-lapse
// detection, reminders) register here starting Level 3.3. No jobs yet: this is
// the skeleton entrypoint proving the process boots and shares
// /packages/domain and /packages/db with the web app.

export const logger = pino({ name: 'fitcrew-worker' });

export function start(): void {
  logger.info('FitCrew worker starting — no jobs registered yet (Level 3.3+)');
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
