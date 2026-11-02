// src/args.ts
class UsageError extends Error {
}
function parseFlags(argv, spec, stopAtPositional = false) {
  const byAlias = new Map;
  for (const [name, s] of Object.entries(spec)) {
    byAlias.set(`--${name}`, name);
    for (const a of s.alias ?? [])
      byAlias.set(a, name);
  }
  const opts = {};
  const rest = [];
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const name = byAlias.get(flag);
    if (name) {
      const s = spec[name];
      if (s.value) {
        const v = inline ?? argv[++i];
        if (v === undefined)
          throw new UsageError(`option ${flag} needs a value`);
        if (s.multi)
          opts[name] = [...opts[name] ?? [], v];
        else
          opts[name] = v;
      } else
        opts[name] = true;
      continue;
    }
    if (a.startsWith("-") && a !== "-") {
      if (stopAtPositional && rest.length > 0) {
        rest.push(a);
        continue;
      }
      throw new UsageError(`unknown option ${a}`);
    }
    rest.push(a);
    if (stopAtPositional) {
      rest.push(...argv.slice(i + 1));
      break;
    }
  }
  return { opts, rest };
}
var str = (v) => typeof v === "string" ? v : "";
var list = (v) => Array.isArray(v) ? v : typeof v === "string" ? [v] : [];

export { UsageError, parseFlags, str, list };
