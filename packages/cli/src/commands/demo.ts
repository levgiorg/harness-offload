// `offload demo` — a 10-second, model-free tour: the read guard and the
// output digest on generated files, with the numbers that matter.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../digest.ts";
import { bigFileMessage } from "../hooks/logic.ts";
import { estTokens, fileBytes, fileLines, fmtInt } from "../text.ts";
import { banner, color, sym } from "../ui.ts";

function ledger(): string {
  const acct = ["cash", "inventory", "receivables", "payables", "payroll", "tax", "shipping", "returns", "warranty", "discounts"];
  const out = ["// Ledger operations for the warehouse back office.", 'import { Money, add, mul } from "./money";', 'import { Account, Entry, Journal } from "./model";', "", "export const MAX_BATCH = 500;", "export const LATE_FEE_RATE = 0.025;", ""];
  for (let i = 1; i <= 80; i++) {
    const a = acct[i % 10];
    const A = a[0].toUpperCase() + a.slice(1);
    out.push(`/** Posts a ${a} adjustment (batch rule ${i}). */`, `export function post${A}Adjustment${i}(journal: Journal, account: Account, amount: Money): Entry {`, `  if (journal.entries.length >= MAX_BATCH) throw new Error("batch ${i} is full");`, `  const entry: Entry = { account: account.id, amount: mul(amount, ${(i % 7) + 1}), memo: "${a}-${i}" };`, "  journal.entries.push(entry);", "  account.balance = add(account.balance, entry.amount);", "  return entry;", "}", "");
  }
  return out.join("\n") + "\n";
}

function ciLog(): string {
  const out = ["$ npm test", "", "> warehouse@1.4.0 test", "> vitest run", ""];
  for (let i = 1; i <= 1600; i++) {
    out.push(` ✓ src/module${String(i % 180).padStart(3, "0")}.test.ts > case ${i} passes (${(i * 7) % 40}ms)`);
    if (i === 777) out.push(" ✗ src/inventory.test.ts > commit > refuses an expired reservation", '   AssertionError: expected promise to reject with "expired" but it resolved', "    ❯ src/inventory.test.ts:41:51");
  }
  out.push("", " Test Files  1 failed | 179 passed (180)", "      Tests  1 failed | 1599 passed (1600)");
  return out.join("\n") + "\n";
}

const box = (title: string, body: string) => {
  const lines = body.trimEnd().split("\n");
  return `  ${color.dim("┌─")} ${color.bold(title)}\n${lines.map((l) => `  ${color.dim("│")} ${l}`).join("\n")}\n  ${color.dim("└─")}\n`;
};

export async function cmdDemo(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "offload-demo-"));
  const file = join(dir, "ledger.ts");
  const log = join(dir, "ci.log");
  writeFileSync(file, ledger());
  writeFileSync(log, ciLog());
  process.chdir(dir);
  const lines = fileLines(file);
  const tokens = estTokens(fileBytes(file));
  let out = banner("demo — no model calls");
  out += `\n  ${color.bold("1. Your agent asks to Read a big file")}  ${color.dim(`(${fmtInt(lines)} lines, ~${fmtInt(tokens)} tokens)`)}\n`;
  out += `  ${sym.arrow} the read guard answers instead — an outline and three cheaper options:\n\n`;
  const msg = bigFileMessage("claude", "ledger.ts", lines, tokens, "A full Read").split("\n");
  const shown = msg.slice(0, 14);
  out += box("what the agent sees", [...shown, ...(msg.length > shown.length ? [color.dim(`… ${msg.length - shown.length} more outline lines`)] : [])].join("\n"));
  out += `  ${sym.ok} it reads a 40-line slice or asks ${color.cyan('offload read -q "…" ledger.ts')} → ~${fmtInt(450)} tokens instead of ~${fmtInt(tokens)}\n`;

  const logTokens = estTokens(fileBytes(log));
  out += `\n  ${color.bold("2. Your agent runs the test suite")}  ${color.dim(`(${fmtInt(fileLines(log))} lines of output, ~${fmtInt(logTokens)} tokens)`)}\n`;
  process.env.OFFLOAD_NO_MODEL = "1";
  const d = await digest(log, "npm test", "1", "", "demo");
  out += `  ${sym.arrow} it gets a digest (verbatim failures + tail + full-log path; a cheap model adds a summary when configured):\n\n`;
  out += box("what the agent sees", d.split("\n").slice(0, 9).join("\n") + `\n${color.dim("…")}`);
  out += `  ${sym.ok} ~${fmtInt(estTokens(Buffer.byteLength(d)))} tokens instead of ~${fmtInt(logTokens)}\n`;
  out += `\n  Next: ${color.cyan("offload setup")} to pick your worker models and wire up your agents.\n\n`;
  process.stdout.write(out);
  return 0;
}
