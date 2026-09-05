import pino from 'pino';
import cron from 'node-cron';
import { ConsoleEmailAdapter } from '@fitcrew/application';
import { acknowledgeEvaluationReminder, computeEvaluationDueEvents, markPendingEvaluationRemindersSent, prisma } from '@fitcrew/db';

// Companion Node worker process (Architecture §4, §12) — the one thing Next.js
// has no runtime for. Scheduled jobs (evaluation due-dates, subscription-lapse
// detection, reminders) register here starting Level 3.3. No jobs yet: this is
// the skeleton entrypoint proving the process boots and shares
// /packages/domain and /packages/db with the web app.

export const logger = pino({ name: 'fitcrew-worker' });

export async function runEvaluationDueJob(asOf = new Date()): Promise<void> {
  const emailAdapter = new ConsoleEmailAdapter();
  const tenants = await prisma.tenant.findMany({ where: { status: { in: ['active', 'trial'] } }, select: { id: true, name: true } });
  for (const tenant of tenants) {
    const due = await computeEvaluationDueEvents(prisma, tenant.id, asOf);
    const reminders = await markPendingEvaluationRemindersSent(prisma, tenant.id, asOf);
    for (const reminder of reminders) {
      if (reminder.recipient) {
        await emailAdapter.sendEvaluationReminder({ recipient: reminder.recipient, clientName: reminder.clientName, dueDate: reminder.dueDate });
      }
      await acknowledgeEvaluationReminder(prisma, tenant.id, reminder.reminderId);
      logger.info({ tenantId: tenant.id, clientName: reminder.clientName, dueDate: reminder.dueDate }, 'EvaluationDue email reminder queued');
    }
    logger.info({ tenantId: tenant.id, tenantName: tenant.name, ...due, reminders: reminders.length }, 'Evaluation due job completed');
  }
}


export function start(): void {
  logger.info('FitCrew worker starting with evaluation due scheduler');
  cron.schedule('*/15 * * * *', () => {
    runEvaluationDueJob().catch((error) => logger.error({ error }, 'Evaluation due job failed'));
  });
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
