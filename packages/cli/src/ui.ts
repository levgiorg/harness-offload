import pc from "picocolors";

const enabled = (stream: NodeJS.WriteStream) => !process.env.NO_COLOR && process.env.TERM !== "dumb" && (stream.isTTY || Boolean(process.env.FORCE_COLOR));
export const color = enabled(process.stdout) ? pc : pc.createColors(false);
export const ecolor = enabled(process.stderr) ? pc : pc.createColors(false);

export const sym = {
  ok: color.green("✓"),
  bad: color.red("✗"),
  warn: color.yellow("!"),
  dot: color.dim("·"),
  arrow: color.cyan("→"),
};

/** Small gradient wordmark; plain when colors are off. */
export function banner(sub = "the harness offloader"): string {
  const word = "code offload";
  const shades = [color.cyan, color.cyan, color.blue, color.blue, color.magenta, color.magenta];
  const painted = [...word].map((ch, i) => shades[Math.floor((i / word.length) * shades.length)](color.bold(ch))).join("");
  return `\n  ${color.dim("▌")}${painted}  ${color.dim(sub)}\n`;
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = all[0].map((_, c) => Math.max(...all.map((r) => plain(r[c] ?? "").length)));
  const line = (r: string[]) =>
    "  " +
    r
      .map((cell, c) => {
        const pad = " ".repeat(widths[c] - plain(cell ?? "").length);
        return /^[\d,.\s%]+$/.test(plain(cell ?? "")) ? pad + cell : cell + pad;
      })
      .join("   ");
  const out = header ? [color.bold(line(header)), color.dim("  " + widths.map((w) => "─".repeat(w)).join("   "))] : [];
  return [...out, ...rows.map(line)].join("\n") + "\n";
}

export function section(title: string): string {
  return `\n  ${color.bold(title)}\n`;
}
