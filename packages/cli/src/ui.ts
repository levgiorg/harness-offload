// ANSI colours, decided per stream once it is first used (a hook writes JSON
// and must not pay for terminal detection it never needs).
type Paint = (s: string) => string;
type Palette = { bold: Paint; dim: Paint; red: Paint; green: Paint; yellow: Paint; blue: Paint; magenta: Paint; cyan: Paint };
const SGR: Record<keyof Palette, [number, number]> = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39] };

function palette(on: () => boolean): Palette {
  let state: boolean | undefined;
  const out = {} as Palette;
  for (const [name, [open, close]] of Object.entries(SGR) as [keyof Palette, [number, number]][]) {
    const o = `\x1b[${open}m`, c = `\x1b[${close}m`;
    // nested styles keep working: re-open after an inner close of the same kind
    out[name] = (s: string) => ((state ??= on()) ? o + String(s).split(c).join(c + o) + c : String(s));
  }
  return out;
}

const enabled = (stream: NodeJS.WriteStream) => !process.env.NO_COLOR && process.env.TERM !== "dumb" && (Boolean(stream.isTTY) || Boolean(process.env.FORCE_COLOR));
export const color = palette(() => enabled(process.stdout));
export const ecolor = palette(() => enabled(process.stderr));

export const sym = {
  ok: color.green("✓"),
  bad: color.red("✗"),
  warn: color.yellow("!"),
  dot: color.dim("·"),
  arrow: color.cyan("→"),
};

/** Small gradient wordmark; plain when colors are off. */
export function banner(sub = "the harness offloader"): string {
  const word = "harness offload";
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
