MAX_BATCH is 500. applyLateFee charges 2.5% of the account balance for receivables more than 30 days overdue, with a TODO to cap the fee at 50.00 that is not implemented. LedgerReconciler has 40 reconcile methods.

- MAX_BATCH: `export const MAX_BATCH = 500;` ({{DIR}}/fx/ledger.ts:L5). Each posting function throws when `journal.entries.length >= MAX_BATCH`.
- applyLateFee (ledger.ts:L415-L421):
  - Rate: `LATE_FEE_RATE` is `0.025` (ledger.ts:L6), used as `mul(account.balance, LATE_FEE_RATE)`.
  - Threshold: `if (daysOverdue <= 30) return 0 as Money;` ({{DIR}}/fx/ledger.ts:L417), so fees apply only when daysOverdue is greater than 30.
  - Effect: the fee is added to `account.balance` and returned.
  - TODO: {{DIR}}/fx/ledger.ts:L415 `/** Applies the late fee to an overdue receivable. TODO: cap the fee at 50.00 */`. No cap logic appears in the function body.
- Reconcile methods: 40, all in class `LedgerReconciler` ({{DIR}}/fx/ledger.ts:L676).
  - Range: {{DIR}}/fx/ledger.ts:L679 `reconcileInventory1(account: Account): boolean {` through {{DIR}}/fx/ledger.ts:L913 `reconcileCash40(account: Account): boolean {`.
  - Each filters journal entries by account id and memo prefix, then compares the sum to `account.balance`.

