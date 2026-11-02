// src/ui.ts
var SGR = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39] };
function palette(on) {
  let state;
  const out = {};
  for (const [name, [open, close]] of Object.entries(SGR)) {
    const o = `\x1B[${open}m`, c = `\x1B[${close}m`;
    out[name] = (s) => (state ??= on()) ? o + String(s).split(c).join(c + o) + c : String(s);
  }
  return out;
}
var enabled = (stream) => !process.env.NO_COLOR && process.env.TERM !== "dumb" && (Boolean(stream.isTTY) || Boolean(process.env.FORCE_COLOR));
var color = palette(() => enabled(process.stdout));
var ecolor = palette(() => enabled(process.stderr));
var sym = {
  ok: color.green("✓"),
  bad: color.red("✗"),
  warn: color.yellow("!"),
  dot: color.dim("·"),
  arrow: color.cyan("→")
};
function banner(sub = "the harness offloader") {
  const word = "harness offload";
  const shades = [color.cyan, color.cyan, color.blue, color.blue, color.magenta, color.magenta];
  const painted = [...word].map((ch, i) => shades[Math.floor(i / word.length * shades.length)](color.bold(ch))).join("");
  return `
  ${color.dim("▌")}${painted}  ${color.dim(sub)}
`;
}
function table(rows, header) {
  const all = header ? [header, ...rows] : rows;
  const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = all[0].map((_, c) => Math.max(...all.map((r) => plain(r[c] ?? "").length)));
  const line = (r) => "  " + r.map((cell, c) => {
    const pad = " ".repeat(widths[c] - plain(cell ?? "").length);
    return /^[\d,.\s%]+$/.test(plain(cell ?? "")) ? pad + cell : cell + pad;
  }).join("   ");
  const out = header ? [color.bold(line(header)), color.dim("  " + widths.map((w) => "─".repeat(w)).join("   "))] : [];
  return [...out, ...rows.map(line)].join(`
`) + `
`;
}
function section(title) {
  return `
  ${color.bold(title)}
`;
}

export { color, sym, banner, table, section };
