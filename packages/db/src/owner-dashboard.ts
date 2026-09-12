import { Prisma, PrismaClient } from '@prisma/client';
import { effectiveAssignments } from '@fitcrew/application';
import { resolvePrincipal } from './access-gate.js';
import { withTenant, type TransactionCapableClient } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
export class OwnerDashboardError extends Error {}
const money = (value: Prisma.Decimal | number | string) => Number(value.toString());
const day = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const startOfWeek = (date: Date) => { const result = day(date); const weekday = result.getUTCDay(); result.setUTCDate(result.getUTCDate() - (weekday === 0 ? 6 : weekday - 1)); return result; };
const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const addDays = (date: Date, days: number) => { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; };

export async function getOwnerDashboard(client: PrismaClient, tenantId: string, userId: string) {
  return withTenant(client as unknown as TransactionCapableClient<Tx>, tenantId, async (tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal || !effectiveAssignments(principal).some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')) throw new OwnerDashboardError('Forbidden.');
    const now = new Date(); const today = day(now); const week = startOfWeek(now); const month = startOfMonth(now); const nextWeek = addDays(week, 7); const thirtyDaysAgo = addDays(today, -30);
    const [clients, sessions, recentSessions, payments, accruals, schedules, subscriptions, coaches, organizations, satisfaction] = await Promise.all([
      tx.client.findMany({ where: { tenantId, status: 'active' }, select: { id: true, partyId: true, organizationId: true, currentCoachAssignmentId: true, updatedAt: true, party: { select: { displayName: true } } } }),
      tx.trainingSession.findMany({ where: { tenantId, sessionDate: { gte: week, lt: nextWeek } }, select: { coachPartyId: true, clientId: true } }),
      tx.trainingSession.findMany({ where: { tenantId, sessionDate: { gte: thirtyDaysAgo, lt: addDays(today, 1) } }, select: { clientId: true, sessionDate: true, startTime: true, client: { select: { party: { select: { displayName: true } } } } }, orderBy: [{ sessionDate: 'desc' }, { startTime: 'desc' }], take: 3 }),
      tx.paymentRecord.findMany({ where: { tenantId, status: 'confirmed', confirmedAt: { gte: month } }, select: { amount: true } }),
      tx.commissionAccrual.findMany({ where: { tenantId, settlementId: null }, select: { coachAssignmentId: true, coachAssignment: { select: { coachPartyId: true } }, coachPayableAmount: true } }),
      tx.evaluationSchedule.findMany({ where: { tenantId, isActive: true, nextDueDate: { lte: today } }, select: { clientId: true, nextDueDate: true, client: { select: { party: { select: { displayName: true } } } } } }),
      tx.subscription.findMany({ where: { tenantId, status: 'active', endDate: { lt: today } }, select: { clientId: true, endDate: true, client: { select: { party: { select: { displayName: true } } } } } }),
      tx.party.findMany({ where: { tenantId, kind: 'person', status: 'active', roleAssignments: { some: { role: 'Coach', validTo: null } } }, select: { id: true, displayName: true } }),
      tx.organization.findMany({ where: { tenantId, status: 'active' }, include: { party: true }, orderBy: { party: { displayName: 'asc' } } }),
      tx.satisfactionRecord.findMany({ where: { tenantId, capturedAt: { gte: month } }, select: { score: true, clientId: true } }),
    ]);
    const assignmentRows = await tx.clientCoachAssignment.findMany({ where: { tenantId, validTo: null }, select: { id: true, clientId: true, coachPartyId: true } });
    const clientById = new Map(clients.map((client) => [client.id, client])); const assignmentByClient = new Map(assignmentRows.map((assignment) => [assignment.clientId, assignment])); const recentlyActiveClientIds = new Set(recentSessions.map((session) => session.clientId));
    const coachRows = coaches.map((coach) => { const roster = clients.filter((client) => assignmentByClient.get(client.id)?.coachPartyId === coach.id); const coachSessions = sessions.filter((session) => session.coachPartyId === coach.id); const payable = accruals.filter((accrual) => accrual.coachAssignment.coachPartyId === coach.id).reduce((sum, accrual) => sum + money(accrual.coachPayableAmount), 0); const scores = satisfaction.filter((row) => roster.some((client) => client.id === row.clientId)).map((row) => row.score); return { coachPartyId: coach.id, name: coach.displayName, activeClients: roster.length, sessionsThisWeek: coachSessions.length, outstandingPayable: payable, satisfaction: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null }; });
    const orgRows = organizations.map((organization) => { const members = clients.filter((client) => client.organizationId === organization.id); const coachIds = new Set(members.map((client) => assignmentByClient.get(client.id)?.coachPartyId).filter(Boolean)); return { organizationId: organization.id, name: organization.party.displayName, members: members.length, coaches: coachIds.size, agreementStatus: organization.status }; });
    const exceptions = { lapsedSubscriptions: subscriptions.map((row) => ({ clientId: row.clientId, clientName: row.client.party.displayName, endDate: row.endDate.toISOString().slice(0, 10) })), overdueEvaluations: schedules.map((row) => ({ clientId: row.clientId, clientName: row.client.party.displayName, dueDate: row.nextDueDate.toISOString().slice(0, 10) })), inactiveClients: clients.filter((client) => !recentlyActiveClientIds.has(client.id)).map((client) => ({ clientId: client.id, clientName: client.party.displayName })), unsettledPayables: coachRows.filter((coach) => coach.outstandingPayable > 0).map((coach) => ({ coachPartyId: coach.coachPartyId, coachName: coach.name, amount: coach.outstandingPayable })) };
    return { refreshedAt: now.toISOString(), period: { weekStarting: week.toISOString().slice(0, 10), monthStarting: month.toISOString().slice(0, 10) }, kpis: { activeClients: clients.length, sessionsThisWeek: sessions.length, revenueThisMonth: payments.reduce((sum, payment) => sum + money(payment.amount), 0), outstandingPayables: accruals.reduce((sum, accrual) => sum + money(accrual.coachPayableAmount), 0), evaluationsDue: schedules.length, activeOrganizations: organizations.length }, activity: { recentSessions: recentSessions.map((session) => ({ clientName: session.client.party.displayName, sessionDate: session.sessionDate.toISOString().slice(0, 10), startTime: session.startTime })) }, coaches: coachRows, organizations: orgRows, exceptions, drillDown: { clientCount: clientById.size } };
  });
}

export function cleanOwnerDashboardError(error: unknown) { return error instanceof OwnerDashboardError ? error.message : 'Owner dashboard is unavailable.'; }
