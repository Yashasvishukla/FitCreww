// Money module public barrel (Architecture §8, §11, §12).
// Owns: LedgerAccount/Entry/Line, CommissionStrategy, ClientEngagementClock,
// Settlement, Payslip use cases. Never imports sibling module internals — it
// reacts to domain events only (enforced by dependency-cruiser rule
// "money-does-not-import-siblings"). Landing starting Level 4.1.

export const MONEY_MODULE = 'money';
