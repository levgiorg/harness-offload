MAX_BATCH is 500, the entry-count cap each `post*` function checks. `applyLateFee` charges 2.5% of the account balance once `daysOverdue` exceeds 30, with a TODO to cap the fee at 50.00 that is not implemented. `LedgerReconciler` has 40 reconcile methods.

- **MAX_BATCH**: `export const MAX_BATCH = 500;` ({{DIR}}/fx/ledger.ts:L5). Each posting function throws when `journal.entries.length >= MAX_BATCH`, e.g. `if (journal.entries.length >= MAX_BATCH) {` ({{DIR}}/fx/ledger.ts:L10-L11).
- **applyLateFee** ({{DIR}}/fx/ledger.ts:L415-L421):
  - Rate: `LATE_FEE_RATE = 0.025` ({{DIR}}/fx/ledger.ts:L6).
  - Threshold: `if (daysOverdue <= 30) return 0 as Money;` ({{DIR}}/fx/ledger.ts:L417), so fees apply only above 30 days.
  - Fee: `const fee = mul(account.balance, LATE_FEE_RATE);` ({{DIR}}/fx/ledger.ts:L418), added to `account.balance` ({{DIR}}/fx/ledger.ts:L419), and returned.
  - TODO: `/** Applies the late fee to an overdue receivable. TODO: cap the fee at 50.00 */` ({{DIR}}/fx/ledger.ts:L415). No cap is present in the function body.
- **LedgerReconciler**: 40 methods, `reconcileInventory1` through `reconcileCash40` ({{DIR}}/fx/ledger.ts:L676-L918). They cycle through 10 categories (inventory, receivables, payables, payroll, tax, shipping, returns, warranty, discounts, cash), with numbered suffixes 1–40.

Uncertain: none.

