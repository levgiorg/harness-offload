#!/usr/bin/env bash
# Deterministic large fixtures for hook evals and benchmarks.
#   evals/fixtures/generate.sh OUT_DIR
# Produces:
#   ledger.ts  ~920 lines: a long accounting module with a few planted facts
#   ci.log     ~2,300 lines: a noisy CI run with two failing tests and warnings
set -eu
out="${1:?usage: generate.sh OUT_DIR}"
mkdir -p "$out"

awk 'BEGIN {
  print "// Ledger operations for the warehouse back office."
  print "import { Money, add, sub, mul } from \"./money\";"
  print "import { Account, Entry, Journal } from \"./model\";"
  print ""
  print "export const MAX_BATCH = 500;"
  print "export const LATE_FEE_RATE = 0.025;"
  print ""
  split("cash,inventory,receivables,payables,payroll,tax,shipping,returns,warranty,discounts", acct, ",")
  n = 0
  for (i = 1; i <= 60; i++) {
    a = acct[(i % 10) + 1]
    printf "/** Posts a %s adjustment (batch rule %d). */\n", a, i
    printf "export function post%sAdjustment%d(journal: Journal, account: Account, amount: Money): Entry {\n", toupper(substr(a,1,1)) substr(a,2), i
    printf "  if (journal.entries.length >= MAX_BATCH) {\n"
    printf "    throw new Error(\"batch %d is full\");\n", i
    printf "  }\n"
    printf "  const entry: Entry = { account: account.id, amount: mul(amount, %d), memo: \"%s-%d\" };\n", (i % 7) + 1, a, i
    printf "  journal.entries.push(entry);\n"
    printf "  account.balance = add(account.balance, entry.amount);\n"
    printf "  return entry;\n"
    printf "}\n\n"
    if (i == 37) {
      print "/** Applies the late fee to an overdue receivable. TODO: cap the fee at 50.00 */"
      print "export function applyLateFee(account: Account, daysOverdue: number): Money {"
      print "  if (daysOverdue <= 30) return 0 as Money;"
      print "  const fee = mul(account.balance, LATE_FEE_RATE);"
      print "  account.balance = add(account.balance, fee);"
      print "  return fee;"
      print "}"
      print ""
    }
  }
  print "export class LedgerReconciler {"
  print "  constructor(private readonly journal: Journal) {}"
  print ""
  for (i = 1; i <= 40; i++) {
    a = acct[(i % 10) + 1]
    printf "  reconcile%s%d(account: Account): boolean {\n", toupper(substr(a,1,1)) substr(a,2), i
    printf "    const posted = this.journal.entries.filter((e) => e.account === account.id && e.memo.startsWith(\"%s\"));\n", a
    printf "    const total = posted.reduce((sum, e) => add(sum, e.amount), 0 as Money);\n"
    printf "    return sub(total, account.balance) === 0;\n"
    printf "  }\n\n"
  }
  print "}"
}' > "$out/ledger.ts"

awk 'BEGIN {
  print "$ npm ci"
  for (i = 1; i <= 400; i++) printf "npm http fetch GET 200 https://registry.example.test/pkg-%d 12ms (cache hit)\n", i
  print "added 812 packages in 9s"
  print "$ npm test"
  print ""
  print "> warehouse@1.4.0 test"
  print "> vitest run"
  print ""
  for (i = 1; i <= 1900; i++) {
    printf " \342\234\223 src/module%03d.test.ts > case %d passes (%dms)\n", i % 180, i, (i * 7) % 40
    if (i == 777) {
      print " \342\234\227 src/inventory.test.ts > commit > refuses an expired reservation"
      print "   AssertionError: expected promise to reject with \"expired\" but it resolved"
      print "    \342\235\257 src/inventory.test.ts:41:51"
    }
    if (i == 1500) {
      print " \342\234\227 src/pricing.test.ts > quote > applies the 10% bulk tier at 100 units"
      print "   AssertionError: expected 1080.00 to equal 1071.36"
      print "    \342\235\257 src/pricing.test.ts:88:34"
    }
    if (i % 300 == 0) print "(node:4242) Warning: --experimental-loader is deprecated"
  }
  print ""
  print " Test Files  2 failed | 178 passed (180)"
  print "      Tests  2 failed | 1898 passed (1900)"
  print "   Duration  41.27s"
}' > "$out/ci.log"
echo "$out/ledger.ts $(awk 'END{print NR}' "$out/ledger.ts") lines"
echo "$out/ci.log $(awk 'END{print NR}' "$out/ci.log") lines"
