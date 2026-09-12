import { Prisma, PrismaClient } from '@prisma/client';
import { effectiveAssignments } from '@fitcrew/application';
import { resolvePrincipal } from './access-gate.js';
import { withTenant, type TransactionCapableClient } from './with-tenant.js';

type Tx = Prisma.TransactionClient;
export class OrgDashboardError extends Error {}
const day = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const addDays = (date: Date, days: number) => { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; };

export async function getOrgDashboardForUser(client: PrismaClient, tenantId: string, userId: string) {
  return withTenant(client as unknown as TransactionCapableClient<Tx>, tenantId, async (tx) => {
    const principal = await resolvePrincipal(tx, tenantId, userId); if (!principal) throw new OrgDashboardError('Forbidden.');
    const assignments = effectiveAssignments(principal).filter((assignment) => assignment.role === 'OrgAdmin' && assignment.scopeType === 'organization' && assignment.scopeId);
    if (!assignments.length) throw new OrgDashboardError('Organization dashboard is only available to organization administrators.');
    const organizationIds = [...new Set(assignments.map((assignment) => assignment.scopeId!))]; const today = day(new Date()); const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); const thirtyDaysAgo = addDays(today, -30);
    const [organizations, clients, sessions, evaluations, schedules, satisfaction, coaches] = await Promise.all([
      tx.organization.findMany({ where: { tenantId, id: { in: organizationIds }, status: 'active' }, include: { party: true }, orderBy: { party: { displayName: 'asc' } } }),
      tx.client.findMany({ where: { tenantId, organizationId: { in: organizationIds }, status: { not: 'left' } }, select: { id: true, organizationId: true, party: { select: { displayName: true } }, currentCoachAssignment: { select: { coachPartyId: true, coachParty: { select: { displayName: true } } } } } }),
      tx.trainingSession.findMany({ where: { tenantId, client: { organizationId: { in: organizationIds } }, sessionDate: { gte: thirtyDaysAgo, lt: today } }, select: { clientId: true, sessionDate: true } }),
      tx.evaluation.findMany({ where: { tenantId, client: { organizationId: { in: organizationIds } }, evaluatedAt: { gte: monthStart } }, select: { clientId: true, evaluatedAt: true, type: true, measurements: true } }),
      tx.evaluationSchedule.findMany({ where: { tenantId, client: { organizationId: { in: organizationIds } }, isActive: true, nextDueDate: { lte: today } }, select: { clientId: true, nextDueDate: true } }),
      tx.satisfactionRecord.findMany({ where: { tenantId, client: { organizationId: { in: organizationIds } }, capturedAt: { gte: monthStart } }, select: { clientId: true, score: true } }),
      tx.roleAssignment.findMany({ where: { tenantId, role: 'Coach', validTo: null, OR: [{ scopeType: 'tenant' }, { scopeType: 'organization', scopeId: { in: organizationIds } }] }, select: { partyId: true, party: { select: { displayName: true } } }, distinct: ['partyId'] }),
    ]);
    const activeClientIds = new Set(clients.map((client) => client.id)); const sessionClientIds = new Set(sessions.map((session) => session.clientId)); const scores = satisfaction.map((row) => row.score);
    return { refreshedAt: new Date().toISOString(), organizations: organizations.map((organization) => ({ id: organization.id, name: organization.party.displayName })), kpis: { members: clients.length, sessionsLast30Days: sessions.length, evaluationsThisMonth: evaluations.length, evaluationsDue: schedules.length, satisfaction: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null }, coaches: coaches.map((coach) => ({ partyId: coach.partyId, name: coach.party.displayName, members: clients.filter((client) => client.currentCoachAssignment?.coachPartyId === coach.partyId).length })), members: clients.map((client) => ({ clientId: client.id, name: client.party.displayName, organizationId: client.organizationId, coach: client.currentCoachAssignment?.coachParty.displayName ?? null, sessionsLast30Days: sessions.filter((session) => session.clientId === client.id).length, latestEvaluation: evaluations.filter((evaluation) => evaluation.clientId === client.id).sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())[0]?.evaluatedAt.toISOString().slice(0, 10) ?? null, evaluationDue: schedules.some((schedule) => schedule.clientId === client.id), satisfaction: satisfaction.filter((row) => row.clientId === client.id).map((row) => row.score)[0] ?? null, active: activeClientIds.has(client.id), recentlyActive: sessionClientIds.has(client.id) })) };
  });
}

export function cleanOrgDashboardError(error: unknown) { return error instanceof OrgDashboardError ? error.message : 'Organization dashboard is unavailable.'; }
