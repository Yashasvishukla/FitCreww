import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessGateForPrincipal, confirmPaymentForUser, confirmSettlementForUser, consumeInvite, createInviteForPrincipal, createOrganizationAndInviteForUser, createSettlementForUser, deletePayoutHandleForUser, downloadPayslipForUser, enrollClientForUser, getEarningsForUser, listClientsForUser, listOrganizationsForUser, PrismaLedgerRepository, recordBaselineForUser, recordClientPaymentForUser, recordOrganizationPaymentForUser, reverseClientPaymentForUser, savePayoutHandleForUser, updatePayoutHandleForUser, updateRefundClawbackRateForUser, withTenant } from '../src/index.js';
import { ConsoleEmailAdapter, createAccessGate, postLedgerEntry } from '@fitcrew/application';
import { MemoryPrivateBlobStorage } from '../src/media-pipeline.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';

loadPackageEnv();

const adminPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const appPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.APP_DATABASE_URL,
    },
  },
});

describe('tenancy core RLS', () => {
  beforeAll(async () => {
    await seedTenant(adminPrisma, tenantId, 'FitCrew Demo', 'INR');
    await seedTenant(adminPrisma, otherTenantId, 'FitCrew Other', 'USD');
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('allows the app role to read only the tenant selected by withTenant', async () => {
    const visibleConfigs = await withTenant(appPrisma, tenantId, async (tx) =>
      tx.tenantConfig.findMany({
        orderBy: { tenantId: 'asc' },
      }),
    );

    expect(visibleConfigs).toHaveLength(1);
    expect(visibleConfigs[0]?.tenantId).toBe(tenantId);
    expect(visibleConfigs[0]?.currency).toBe('INR');
  });

  it('blocks cross-tenant raw SQL under the app role even when Prisma scoping is bypassed', async () => {
    const rows = await withTenant(appPrisma, tenantId, async (tx) =>
      tx.$queryRaw<Array<{ tenant_id: string }>>`
        SELECT tenant_id
        FROM public.tenant_config
        WHERE tenant_id = ${otherTenantId}::uuid
      `,
    );

    expect(rows).toEqual([]);
  });

  it('rejects app-role writes for a different tenant through RLS', async () => {
    await expect(
      withTenant(appPrisma, tenantId, async (tx) =>
        tx.$executeRaw`
          INSERT INTO public.tenant_config (
            tenant_id,
            default_commission_rate,
            default_commission_lifespan_months,
            default_evaluation_cadence,
            fee_bearer,
            satisfaction_mode,
            currency
          )
          VALUES (
            ${otherTenantId}::uuid,
            12.00,
            4,
            'monthly'::public."EvaluationCadence",
            'tenant'::public."FeeBearer",
            'per_session'::public."SatisfactionMode",
            'EUR'
          )
          ON CONFLICT (tenant_id) DO UPDATE SET currency = EXCLUDED.currency
        `,
      ),
    ).rejects.toThrow();
  });

  it('commits balanced journals and rejects mutation or an unbalanced commit at the database', async () => {
    const ownerPartyId = randomUUID();
    const clientPartyId = randomUUID();
    const paymentId = randomUUID();

    const posted = await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.createMany({ data: [
        { id: ownerPartyId, tenantId, kind: 'person', displayName: 'Ledger Owner' },
        { id: clientPartyId, tenantId, kind: 'person', displayName: 'Ledger Client' },
      ] });
      return postLedgerEntry(new PrismaLedgerRepository(tx), {
        tenantId,
        description: 'Confirmed client payment',
        referenceType: 'payment',
        referenceId: paymentId,
        lines: [
          { partyId: ownerPartyId, purpose: 'owner_cash', direction: 'debit', amountMinor: 250_000n },
          { partyId: clientPartyId, purpose: 'client_receivable', direction: 'credit', amountMinor: 250_000n },
        ],
      });
    });

    await expect(withTenant(appPrisma, tenantId, (tx) => tx.ledgerEntry.updateMany({
      where: { id: posted.id, tenantId },
      data: { description: 'tampered' },
    }))).rejects.toThrow(/permission denied|append-only/);
    await expect(adminPrisma.ledgerEntry.update({
      where: { id: posted.id },
      data: { description: 'admin tamper attempt' },
    })).rejects.toThrow(/append-only/);

    await expect(withTenant(appPrisma, tenantId, async (tx) => {
      const account = await tx.ledgerAccount.findFirstOrThrow({ where: { partyId: ownerPartyId } });
      const unbalanced = await tx.ledgerEntry.create({
        data: {
          tenantId,
          description: 'Unbalanced journal',
          referenceType: 'correction',
          referenceId: randomUUID(),
        },
      });
      await tx.ledgerLine.create({
        data: { tenantId, entryId: unbalanced.id, accountId: account.id, direction: 'debit', amount: '1.00' },
      });
      return tx.$executeRaw`SET CONSTRAINTS ledger_line_balance_check IMMEDIATE`;
    })).rejects.toThrow(/balance to zero/);
  });

  it('records and manually confirms a client payment with ledger and audit atomically', async () => {
    const userId = randomUUID(); const ownerId = randomUUID(); const coachId = randomUUID(); const clientPartyId = randomUUID(); const clientId = randomUUID(); const assignmentId = randomUUID(); const subscriptionId = randomUUID();
    await adminPrisma.user.create({ data: { id: userId, email: `money-${userId}@fitcrew.test` } });
    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.createMany({ data: [
        { id: ownerId, tenantId, userId, kind: 'person', displayName: 'Payment Owner' },
        { id: coachId, tenantId, kind: 'person', displayName: 'Payment Coach' },
        { id: clientPartyId, tenantId, kind: 'person', displayName: 'Payment Client' },
      ] });
      await tx.roleAssignment.create({ data: { tenantId, partyId: ownerId, role: 'OwnerAdmin', scopeType: 'tenant', validFrom: new Date('2026-01-01') } });
      await tx.engagement.create({ data: { tenantId, upstreamPartyId: ownerId, downstreamPartyId: coachId, commissionRate: '20.00', commissionLifespanMonths: 3, validFrom: new Date('2026-01-01') } });
      await tx.client.create({ data: { id: clientId, tenantId, partyId: clientPartyId, enrolledByPartyId: ownerId, customPrice: '3000.00' } });
      await tx.clientCoachAssignment.create({ data: { id: assignmentId, tenantId, clientId, coachPartyId: coachId, assignedByPartyId: ownerId, validFrom: new Date('2026-01-01') } });
      await tx.client.updateMany({ where: { id: clientId }, data: { currentCoachAssignmentId: assignmentId } });
      await tx.subscription.create({ data: { id: subscriptionId, tenantId, clientId, price: '3000.00', startDate: new Date('2026-09-01'), durationMonths: 1, endDate: new Date('2026-09-30') } });
    });
    const temporaryHandle = await savePayoutHandleForUser(appPrisma, tenantId, userId, { partyId: ownerId, type: 'phone', value: '+919876543210' });
    await updatePayoutHandleForUser(appPrisma, tenantId, userId, { handleId: temporaryHandle.id, partyId: ownerId, type: 'upi', value: 'owner.secondary@okbank', label: 'Secondary' });
    await deletePayoutHandleForUser(appPrisma, tenantId, userId, temporaryHandle.id);
    expect(await withTenant(appPrisma, tenantId, (tx) => tx.payoutHandle.count({ where: { id: temporaryHandle.id } }))).toBe(0);
    await savePayoutHandleForUser(appPrisma, tenantId, userId, { partyId: ownerId, type: 'upi', value: 'owner@okbank', isDefault: true });
    const pending = await recordClientPaymentForUser(appPrisma, tenantId, userId, { subscriptionId, amount: '3000.00', method: 'upi' });
    const confirmed = await confirmPaymentForUser(appPrisma, tenantId, userId, { paymentId: pending.id, utr: 'UTR123456789' });
    expect(confirmed).toMatchObject({ id: pending.id, status: 'confirmed' });
    const evidence = await withTenant(appPrisma, tenantId, async (tx) => ({
      payment: await tx.paymentRecord.findFirst({ where: { id: pending.id } }),
      entry: await tx.ledgerEntry.findFirst({ where: { referenceType: 'payment', referenceId: pending.id }, include: { lines: true } }),
      accrual: await tx.commissionAccrual.findFirst({ where: { paymentId: pending.id } }),
      clockCount: await tx.clientEngagementClock.count({ where: { clientId } }),
      audits: await tx.auditLog.count({ where: { resourceId: pending.id, resourceType: 'payment' } }),
    }));
    expect(evidence.payment).toMatchObject({ status: 'confirmed', confirmationSource: 'manual', utr: 'UTR123456789' });
    expect(evidence.entry?.lines).toHaveLength(5);
    expect(evidence.accrual).toMatchObject({ grossAmount: new Prisma.Decimal('3000.00'), rateApplied: new Prisma.Decimal('20.00'), commissionAmount: new Prisma.Decimal('600.00'), coachPayableAmount: new Prisma.Decimal('2400.00'), withinLifespan: true });
    expect(evidence.clockCount).toBe(1);
    expect(evidence.audits).toBe(2);
    await expect(withTenant(appPrisma, tenantId, (tx) => tx.commissionAccrual.updateMany({ where: { paymentId: pending.id }, data: { commissionAmount: '1.00' } }))).rejects.toThrow(/snapshots are immutable/);
    await expect(confirmPaymentForUser(appPrisma, tenantId, userId, { paymentId: pending.id, utr: 'UTR999999' })).rejects.toThrow('unavailable');
    const secondPending = await recordClientPaymentForUser(appPrisma, tenantId, userId, { subscriptionId, amount: '1500.00', method: 'upi' });
    await confirmPaymentForUser(appPrisma, tenantId, userId, { paymentId: secondPending.id, utr: 'UTRSECOND123' });
    const paidOn = confirmed.confirmedAt.slice(0, 10); const storage = new MemoryPrivateBlobStorage();
    const batch = await createSettlementForUser(appPrisma, tenantId, userId, { coachPartyId: coachId, periodStart: paidOn, periodEnd: paidOn, method: 'upi' });
    expect(batch).toMatchObject({ accrualCount: 2, totalAmount: '3600.00', status: 'draft' });
    const paid = await confirmSettlementForUser(appPrisma, tenantId, userId, { settlementId: batch.id, utr: 'PAYOUT123456' }, storage);
    expect(paid.status).toBe('paid');
    const document = await downloadPayslipForUser(appPrisma, tenantId, userId, paid.payslipMediaAssetId, storage);
    expect(String.fromCharCode(...document.bytes.slice(0, 8))).toBe('%PDF-1.4');
    const earnings = await getEarningsForUser(appPrisma, tenantId, userId);
    expect(earnings.payables.find((row) => row.coachPartyId === coachId)).toBeUndefined();
    expect(earnings.settlements).toContainEqual(expect.objectContaining({ id: batch.id, totalAmount: '3600', status: 'paid', payslipMediaAssetId: paid.payslipMediaAssetId }));
    const settlementEntry = await withTenant(appPrisma, tenantId, (tx) => tx.ledgerEntry.findFirst({ where: { referenceType: 'settlement', referenceId: batch.id }, include: { lines: true } }));
    expect(settlementEntry?.lines).toHaveLength(2);
    const coachUserId = randomUUID(); await adminPrisma.user.create({ data: { id: coachUserId, email: `coach-money-${coachUserId}@fitcrew.test` } });
    await withTenant(appPrisma, tenantId, async (tx) => { await tx.party.updateMany({ where: { id: coachId }, data: { userId: coachUserId } }); await tx.roleAssignment.create({ data: { tenantId, partyId: coachId, role: 'Coach', scopeType: 'tenant', validFrom: new Date('2026-01-01') } }); });
    const coachEarnings = await getEarningsForUser(appPrisma, tenantId, coachUserId);
    expect(coachEarnings.owner).toBe(false); expect(coachEarnings.accruals.every((row) => row.coachPartyId === coachId)).toBe(true); expect(coachEarnings.settlements).toContainEqual(expect.objectContaining({ id: batch.id }));
    await expect(downloadPayslipForUser(appPrisma, tenantId, coachUserId, paid.payslipMediaAssetId, storage)).resolves.toMatchObject({ filename: expect.stringContaining(batch.id) });
    await expect(withTenant(appPrisma, tenantId, (tx) => tx.payslip.updateMany({ where: { settlementId: batch.id }, data: { netPaid: '1.00' } }))).rejects.toThrow(/append-only/);
    await expect(confirmSettlementForUser(appPrisma, tenantId, userId, { settlementId: batch.id, utr: 'DUPLICATEPAYOUT' }, storage)).rejects.toThrow(/unavailable/);

    // 4.5: a paid period stays immutable; its refund is a linked reversal and signed next-period correction.
    await updateRefundClawbackRateForUser(appPrisma, tenantId, userId, '100.00');
    const refund = await reverseClientPaymentForUser(appPrisma, tenantId, userId, { paymentId: pending.id, method: 'upi', utr: 'REFUND123456' });
    expect(refund).toMatchObject({ reversesPaymentId: pending.id, coachClawbackAmount: '2400.00', ownerAbsorptionAmount: '0.00' });
    const refundEvidence = await withTenant(appPrisma, tenantId, async (tx) => ({
      original: await tx.paymentRecord.findFirstOrThrow({ where: { id: pending.id } }),
      correction: await tx.paymentRecord.findFirstOrThrow({ where: { id: refund.id } }),
      correctionAccrual: await tx.commissionAccrual.findFirstOrThrow({ where: { paymentId: refund.id } }),
      correctionEntry: await tx.ledgerEntry.findFirstOrThrow({ where: { referenceType: 'correction', referenceId: refund.id }, include: { lines: true } }),
      originalEntry: await tx.ledgerEntry.findFirstOrThrow({ where: { referenceType: 'payment', referenceId: pending.id } }),
      originalPayslipCount: await tx.payslip.count({ where: { settlementId: batch.id } }),
    }));
    expect(refundEvidence.original.status).toBe('reversed');
    expect(refundEvidence.correction).toMatchObject({ status: 'confirmed', purpose: 'correction', reversesPaymentId: pending.id });
    expect(refundEvidence.correctionAccrual).toMatchObject({ kind: 'correction', grossAmount: new Prisma.Decimal('-3000.00'), commissionAmount: new Prisma.Decimal('-600.00'), coachPayableAmount: new Prisma.Decimal('-2400.00'), settlementId: null });
    expect(refundEvidence.correctionEntry.reversesEntryId).toBe(refundEvidence.originalEntry.id);
    expect(refundEvidence.correctionEntry.lines).toHaveLength(3);
    expect(refundEvidence.originalPayslipCount).toBe(1);
    const reversedBalances = await withTenant(appPrisma, tenantId, (tx) => tx.$queryRaw<Array<{ purpose: string; balance: Prisma.Decimal }>>`
      SELECT a.purpose::text AS purpose,
        SUM(CASE WHEN l.direction = 'debit' THEN l.amount ELSE -l.amount END) AS balance
      FROM public.ledger_line l JOIN public.ledger_account a ON a.id = l.account_id
      WHERE l.entry_id IN (${refundEvidence.originalEntry.id}::uuid, ${refundEvidence.correctionEntry.id}::uuid)
      GROUP BY a.purpose
    `);
    expect(reversedBalances.every((row) => row.balance.equals(0))).toBe(true);
    await expect(reverseClientPaymentForUser(appPrisma, tenantId, userId, { paymentId: pending.id, method: 'upi', utr: 'REFUNDAGAIN123' })).rejects.toThrow(/confirmed, unreversed/);

    const nextPayment = await recordClientPaymentForUser(appPrisma, tenantId, userId, { subscriptionId, amount: '4500.00', method: 'upi' });
    await confirmPaymentForUser(appPrisma, tenantId, userId, { paymentId: nextPayment.id, utr: 'NEXTCYCLE1234' });
    const nextBatch = await createSettlementForUser(appPrisma, tenantId, userId, { coachPartyId: coachId, periodStart: paidOn, periodEnd: paidOn, method: 'upi' });
    expect(nextBatch).toMatchObject({ accrualCount: 2, totalAmount: '1200.00' });
    const nextPaid = await confirmSettlementForUser(appPrisma, tenantId, userId, { settlementId: nextBatch.id, utr: 'NEXTPAYOUT123' }, storage);
    const nextPayslip = await withTenant(appPrisma, tenantId, (tx) => tx.payslip.findFirstOrThrow({ where: { settlementId: nextBatch.id } }));
    expect(nextPayslip.detail).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'correction', paymentId: refund.id, net: '-2400' })]));
    expect(nextPaid.status).toBe('paid');

    // Organization agreement collection is one-time and follows the same pending -> manual confirmation -> ledger path.
    const organizationPartyId = randomUUID(); const organizationId = randomUUID();
    await withTenant(appPrisma, tenantId, async (tx) => { await tx.party.create({ data: { id: organizationPartyId, tenantId, kind: 'institution', displayName: 'Money Partner Org' } }); await tx.organization.create({ data: { id: organizationId, tenantId, partyId: organizationPartyId, agreementTerms: { oneTimePayment: true } } }); });
    const orgPending = await recordOrganizationPaymentForUser(appPrisma, tenantId, userId, { organizationId, amount: '10000.00', method: 'upi' });
    const orgConfirmed = await confirmPaymentForUser(appPrisma, tenantId, userId, { paymentId: orgPending.id, utr: 'ORGAGREE1234' });
    expect(orgConfirmed).toMatchObject({ status: 'confirmed', commissionAmount: null, coachPayableAmount: null });
    const orgEntry = await withTenant(appPrisma, tenantId, (tx) => tx.ledgerEntry.findFirst({ where: { referenceType: 'payment', referenceId: orgPending.id }, include: { lines: { include: { account: true } } } }));
    expect(orgEntry?.lines).toHaveLength(2); expect(orgEntry?.lines.map((line) => line.account.purpose)).toEqual(expect.arrayContaining(['owner_cash', 'org_agreement_receivable']));
    await expect(recordOrganizationPaymentForUser(appPrisma, tenantId, userId, { organizationId, amount: '1.00', method: 'other' })).rejects.toThrow(/already has an agreement payment/);
  });

  it('applies tenant isolation to parties', async () => {
    const partyId = randomUUID();
    const otherPartyId = randomUUID();

    await withTenant(appPrisma, tenantId, async (tx) =>
      tx.party.create({
        data: {
          id: partyId,
          tenantId,
          kind: 'person',
          displayName: 'Visible Coach',
          status: 'active',
        },
      }),
    );

    await withTenant(appPrisma, otherTenantId, async (tx) =>
      tx.party.create({
        data: {
          id: otherPartyId,
          tenantId: otherTenantId,
          kind: 'person',
          displayName: 'Hidden Coach',
          status: 'active',
        },
      }),
    );

    const visibleParties = await withTenant(appPrisma, tenantId, async (tx) =>
      tx.party.findMany({
        where: {
          id: {
            in: [partyId, otherPartyId],
          },
        },
        orderBy: { id: 'asc' },
      }),
    );

    expect(visibleParties.map((party) => party.id)).toEqual([partyId]);
  });

  it('rejects engagement self-loops and overlapping duplicate edges', async () => {
    const ownerPartyId = randomUUID();
    const coachPartyId = randomUUID();

    await withTenant(appPrisma, tenantId, async (tx) =>
      tx.party.createMany({
        data: [
          {
            id: ownerPartyId,
            tenantId,
            kind: 'person',
            displayName: 'Owner',
            status: 'active',
          },
          {
            id: coachPartyId,
            tenantId,
            kind: 'person',
            displayName: 'Coach',
            status: 'active',
          },
        ],
      }),
    );

    await expect(
      withTenant(appPrisma, tenantId, async (tx) =>
        tx.engagement.create({
          data: {
            id: randomUUID(),
            tenantId,
            upstreamPartyId: ownerPartyId,
            downstreamPartyId: ownerPartyId,
            commissionRate: 10,
            commissionLifespanMonths: 3,
            validFrom: new Date('2026-09-01T00:00:00.000Z'),
          },
        }),
      ),
    ).rejects.toThrow();

    await withTenant(appPrisma, tenantId, async (tx) =>
      tx.engagement.create({
        data: {
          id: randomUUID(),
          tenantId,
          upstreamPartyId: ownerPartyId,
          downstreamPartyId: coachPartyId,
          commissionRate: 12.5,
          commissionLifespanMonths: 3,
          validFrom: new Date('2026-09-01T00:00:00.000Z'),
          validTo: null,
        },
      }),
    );

    await expect(
      withTenant(appPrisma, tenantId, async (tx) =>
        tx.engagement.create({
          data: {
            id: randomUUID(),
            tenantId,
            upstreamPartyId: ownerPartyId,
            downstreamPartyId: coachPartyId,
            commissionRate: 18,
            commissionLifespanMonths: 8,
            validFrom: new Date('2026-10-01T00:00:00.000Z'),
            validTo: null,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('writes an audit row when a coach is denied another coach resource', async () => {
    const actorPartyId = randomUUID();
    const otherCoachPartyId = randomUUID();

    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.createMany({
        data: [
          { id: actorPartyId, tenantId, kind: 'person', displayName: 'Actor Coach', status: 'active' },
          { id: otherCoachPartyId, tenantId, kind: 'person', displayName: 'Other Coach', status: 'active' },
        ],
      });

      const principal = {
        tenantId,
        partyId: actorPartyId,
        assignments: [{
          role: 'Coach' as const,
          scopeType: 'tenant' as const,
          scopeId: null,
          validFrom: '2026-01-01',
          validTo: null,
        }],
      };
      const gate = accessGateForPrincipal(tx, principal);

      await expect(gate.can(principal, 'read', {
        type: 'session',
        id: randomUUID(),
        coachPartyId: otherCoachPartyId,
        tenantId,
      })).resolves.toBe(false);
    });

    const auditRows = await withTenant(appPrisma, tenantId, (tx) => tx.auditLog.findMany({
      where: { actorPartyId },
    }));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'read',
      resourceType: 'session',
      actorPartyId,
      after: { allowed: false, reason: 'denied' },
    });
  });

  it('consumes an invite once and creates the account and role assignment', async () => {
    const ownerPartyId = randomUUID();
    const emailAdapter = new ConsoleEmailAdapter();
    const principal = {
      tenantId,
      partyId: ownerPartyId,
      assignments: [{
        role: 'OwnerAdmin' as const,
        scopeType: 'tenant' as const,
        scopeId: null,
        validFrom: '2026-01-01',
        validTo: null,
      }],
    };

    const invite = await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.create({
        data: { id: ownerPartyId, tenantId, kind: 'person', displayName: 'Invite Owner', status: 'active' },
      });
      return createInviteForPrincipal(
        tx,
        principal,
        createAccessGate(new Date('2026-09-05T00:00:00.000Z')),
        {
          email: `coach-${randomUUID()}@fitcrew.test`,
          role: 'Coach',
          scopeType: 'tenant',
          scopeId: null,
          baseUrl: 'https://fitcrew.test',
        },
        emailAdapter,
        new Date('2026-09-05T00:00:00.000Z'),
      );
    });

    const rawToken = new URL(emailAdapter.sent[0].inviteUrl).searchParams.get('token');
    expect(rawToken).toBeTruthy();

    const consumed = await consumeInvite(appPrisma, {
      tenantId,
      token: rawToken!,
      password: 'CoachPassword!2026',
      displayName: 'Invited Coach',
    }, new Date('2026-09-05T01:00:00.000Z'));
    expect(consumed.role).toBe('Coach');

    await expect(consumeInvite(appPrisma, {
      tenantId,
      token: rawToken!,
      password: 'CoachPassword!2026',
      displayName: 'Invited Coach Again',
    }, new Date('2026-09-05T01:01:00.000Z'))).rejects.toThrow('invalid or expired');

    const roleCount = await withTenant(appPrisma, tenantId, (tx) => tx.roleAssignment.count({
      where: { role: 'Coach', partyId: consumed.partyId },
    }));
    expect(roleCount).toBe(1);
    expect(invite.role).toBe('Coach');
  });

  it('requires organization scope for OrgAdmin invites', async () => {
    const ownerPartyId = randomUUID();
    const emailAdapter = new ConsoleEmailAdapter();
    const principal = {
      tenantId,
      partyId: ownerPartyId,
      assignments: [{
        role: 'OwnerAdmin' as const,
        scopeType: 'tenant' as const,
        scopeId: null,
        validFrom: '2026-01-01',
        validTo: null,
      }],
    };

    await expect(withTenant(appPrisma, tenantId, async (tx) => {
      await tx.party.create({
        data: { id: ownerPartyId, tenantId, kind: 'person', displayName: 'Org Owner', status: 'active' },
      });
      return createInviteForPrincipal(
        tx,
        principal,
        createAccessGate(),
        {
          email: `org-${randomUUID()}@fitcrew.test`,
          role: 'OrgAdmin',
          scopeType: 'tenant',
          scopeId: null,
          baseUrl: 'https://fitcrew.test',
        },
        emailAdapter,
      );
    })).rejects.toThrow('organization scope');
  });

  it('creates an institution and gives its invited admin an organization-scoped home', async () => {
    const ownerPartyId = randomUUID();
    const ownerUserId = randomUUID();
    const email = `hospital-${randomUUID()}@fitcrew.test`;
    const emailAdapter = new ConsoleEmailAdapter();
    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.user.create({ data: { id: ownerUserId, email: email.replace('hospital-', 'owner-'), name: 'Hospital Owner' } });
      await tx.party.create({ data: { id: ownerPartyId, tenantId, userId: ownerUserId, kind: 'person', displayName: 'Hospital Owner', status: 'active' } });
    });
    await withTenant(appPrisma, tenantId, (tx) => tx.roleAssignment.create({
      data: { tenantId, partyId: ownerPartyId, role: 'OwnerAdmin', scopeType: 'tenant', validFrom: new Date('2026-01-01') },
    }));
    const result = await createOrganizationAndInviteForUser(appPrisma, tenantId, ownerUserId, {
      name: 'General Hospital', email, agreementAmount: '25000', agreementStart: '2026-09-01', agreementEnd: null, baseUrl: 'https://fitcrew.test',
    }, emailAdapter);
    const token = new URL(emailAdapter.sent[0].inviteUrl).searchParams.get('token');
    const admin = await consumeInvite(appPrisma, { tenantId, token: token!, password: 'HospitalPassword!2026', displayName: 'Hospital Admin' });
    const visible = await listOrganizationsForUser(appPrisma, tenantId, admin.userId);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.organizationId).toBe(result.organizationId);
  });

  it('enrolls a client, creates a subscription, and advances after baseline intake', async () => {
    const ownerUserId = randomUUID(); const ownerPartyId = randomUUID(); const coachPartyId = randomUUID();
    await withTenant(appPrisma, tenantId, async (tx) => {
      await tx.user.create({ data: { id: ownerUserId, email: `${randomUUID()}@fitcrew.test`, name: 'Lifecycle Owner' } });
      await tx.party.createMany({ data: [
        { id: ownerPartyId, tenantId, userId: ownerUserId, kind: 'person', displayName: 'Lifecycle Owner', status: 'active' },
        { id: coachPartyId, tenantId, kind: 'person', displayName: 'Lifecycle Coach', status: 'active' },
      ] });
      await tx.roleAssignment.createMany({ data: [
        { tenantId, partyId: ownerPartyId, role: 'OwnerAdmin', scopeType: 'tenant', validFrom: new Date('2026-01-01') },
        { tenantId, partyId: coachPartyId, role: 'Coach', scopeType: 'tenant', validFrom: new Date('2026-01-01') },
      ] });
    });
    const enrolled = await enrollClientForUser(appPrisma, tenantId, ownerUserId, { name: 'Baseline Client', price: '3500', coachPartyId, organizationId: null, schedule: { days: ['monday'] }, photoConsent: false, subscriptionDurationMonths: 3 });
    expect((await listClientsForUser(appPrisma, tenantId, ownerUserId)).some((client) => client.clientId === enrolled.clientId)).toBe(true);
    const baseline = await recordBaselineForUser(appPrisma, tenantId, ownerUserId, { clientId: enrolled.clientId, measurements: { weight: 80, bmi: 25 }, postureNotes: 'Initial assessment' });
    expect(baseline.clientId).toBe(enrolled.clientId);
    await withTenant(appPrisma, tenantId, async (tx) => {
      await expect(tx.evaluation.findFirst({ where: { id: baseline.evaluationId } })).resolves.toMatchObject({ type: 'baseline' });
      await expect(tx.subscription.count({ where: { clientId: enrolled.clientId } })).resolves.toBe(1);
    });
  });
});

async function seedTenant(prisma: PrismaClient, id: string, name: string, currency: string): Promise<void> {
  await prisma.tenant.upsert({
    where: { id },
    update: { name, status: 'trial' },
    create: { id, name, status: 'trial' },
  });

  await prisma.tenantConfig.upsert({
    where: { tenantId: id },
    update: {
      currency,
      defaultCommissionRate: 10,
      defaultCommissionLifespanMonths: 3,
      defaultEvaluationCadence: 'monthly',
      feeBearer: 'tenant',
      satisfactionMode: 'per_session',
    },
    create: {
      tenantId: id,
      currency,
      defaultCommissionRate: 10,
      defaultCommissionLifespanMonths: 3,
      defaultEvaluationCadence: 'monthly',
      feeBearer: 'tenant',
      satisfactionMode: 'per_session',
    },
  });
}

function loadPackageEnv(): void {
  const envPath = resolve(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match === null || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
}
