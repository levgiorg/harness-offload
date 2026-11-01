export class UsageError extends Error {}

export interface FlagSpec {
  [name: string]: { alias?: string[]; value?: boolean; multi?: boolean };
}

export interface Parsed {
  opts: Record<string, string | boolean | string[]>;
  rest: string[];
}

/**
 * Small, predictable parser: `--flag value`, `--flag=value`, `-f value`,
 * boolean flags, repeatable flags, `--` ends options. With `stopAtPositional`
 * everything from the first positional on is passed through untouched (for
 * `offload run CMD --its-own-flags`).
 */
export function parseFlags(argv: string[], spec: FlagSpec, stopAtPositional = false): Parsed {
  const byAlias = new Map<string, string>();
  for (const [name, s] of Object.entries(spec)) {
    byAlias.set(`--${name}`, name);
    for (const a of s.alias ?? []) byAlias.set(a, name);
  }
  const opts: Parsed["opts"] = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
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
        if (v === undefined) throw new UsageError(`option ${flag} needs a value`);
        if (s.multi) opts[name] = [...((opts[name] as string[]) ?? []), v];
        else opts[name] = v;
      } else opts[name] = true;
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

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : []);
