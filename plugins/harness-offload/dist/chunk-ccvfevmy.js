import {
  color,
  sym,
  banner
} from "./chunk-31bdmre5.js";
import"./chunk-t2kssrkb.js";
import {
  fileBytes,
  fileLines,
  estTokens,
  fmtInt
} from "./chunk-ay6k04v0.js";
import"./chunk-9wbe25j8.js";
import"./chunk-fsknd7zt.js";
import"./chunk-w1fzxj4r.js";
import {
  digest
} from "./chunk-fj9gbw5z.js";
import {
  bigFileMessage2
} from "./chunk-16vnn4tr.js";
import"./chunk-3shk5whq.js";

// src/commands/demo.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function ledger() {
  const acct = ["cash", "inventory", "receivables", "payables", "payroll", "tax", "shipping", "returns", "warranty", "discounts"];
  const out = ["// Ledger operations for the warehouse back office.", 'import { Money, add, mul } from "./money";', 'import { Account, Entry, Journal } from "./model";', "", "export const MAX_BATCH = 500;", "export const LATE_FEE_RATE = 0.025;", ""];
  for (let i = 1;i <= 80; i++) {
    const a = acct[i % 10];
    const A = a[0].toUpperCase() + a.slice(1);
    out.push(`/** Posts a ${a} adjustment (batch rule ${i}). */`, `export function post${A}Adjustment${i}(journal: Journal, account: Account, amount: Money): Entry {`, `  if (journal.entries.length >= MAX_BATCH) throw new Error("batch ${i} is full");`, `  const entry: Entry = { account: account.id, amount: mul(amount, ${i % 7 + 1}), memo: "${a}-${i}" };`, "  journal.entries.push(entry);", "  account.balance = add(account.balance, entry.amount);", "  return entry;", "}", "");
  }
  return out.join(`
`) + `
`;
}
function ciLog() {
  const out = ["$ npm test", "", "> warehouse@1.4.0 test", "> vitest run", ""];
  for (let i = 1;i <= 1600; i++) {
    out.push(` ✓ src/module${String(i % 180).padStart(3, "0")}.test.ts > case ${i} passes (${i * 7 % 40}ms)`);
    if (i === 777)
      out.push(" ✗ src/inventory.test.ts > commit > refuses an expired reservation", '   AssertionError: expected promise to reject with "expired" but it resolved', "    ❯ src/inventory.test.ts:41:51");
  }
  out.push("", " Test Files  1 failed | 179 passed (180)", "      Tests  1 failed | 1599 passed (1600)");
  return out.join(`
`) + `
`;
}
var box = (title, body) => {
  const lines = body.trimEnd().split(`
`);
  return `  ${color.dim("┌─")} ${color.bold(title)}
${lines.map((l) => `  ${color.dim("│")} ${l}`).join(`
`)}
  ${color.dim("└─")}
`;
};
async function cmdDemo() {
  const dir = mkdtempSync(join(tmpdir(), "offload-demo-"));
  const file = join(dir, "ledger.ts");
  const log = join(dir, "ci.log");
  writeFileSync(file, ledger());
  writeFileSync(log, ciLog());
  process.chdir(dir);
  const lines = fileLines(file);
  const tokens = estTokens(fileBytes(file));
  let out = banner("demo — no model calls");
  out += `
  ${color.bold("1. Your agent asks to Read a big file")}  ${color.dim(`(${fmtInt(lines)} lines, ~${fmtInt(tokens)} tokens)`)}
`;
  out += `  ${sym.arrow} the read guard answers instead — an outline and three cheaper options:

`;
  const msg = bigFileMessage2("claude", "ledger.ts", lines, tokens, "A full Read").split(`
`);
  const shown = msg.slice(0, 14);
  out += box("what the agent sees", [...shown, ...msg.length > shown.length ? [color.dim(`… ${msg.length - shown.length} more outline lines`)] : []].join(`
`));
  out += `  ${sym.ok} it reads a 40-line slice or asks ${color.cyan('offload read -q "…" ledger.ts')} → ~${fmtInt(450)} tokens instead of ~${fmtInt(tokens)}
`;
  const logTokens = estTokens(fileBytes(log));
  out += `
  ${color.bold("2. Your agent runs the test suite")}  ${color.dim(`(${fmtInt(fileLines(log))} lines of output, ~${fmtInt(logTokens)} tokens)`)}
`;
  const d = await digest(log, "npm test", "1", "", "demo", undefined, { noModel: true });
  out += `  ${sym.arrow} it gets a digest (verbatim failures + tail + full-log path; a cheap model adds a summary when configured):

`;
  out += box("what the agent sees", d.split(`
`).slice(0, 9).join(`
`) + `
${color.dim("…")}`);
  out += `  ${sym.ok} ~${fmtInt(estTokens(Buffer.byteLength(d)))} tokens instead of ~${fmtInt(logTokens)}
`;
  out += `
  Next: ${color.cyan("offload setup")} to pick your worker models and wire up your agents.

`;
  process.stdout.write(out);
  return 0;
}
export {
  cmdDemo
};
