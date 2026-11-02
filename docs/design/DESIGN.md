# Harness Offload — design system

Documented from the built surfaces (`site/index.html`, `packages/cli/src/ui/dashboard.html`).
World: **the closed-stack request slip** — the agent's context is a reading-room desk; offload sends a
slip to the stacks and the answer comes back with its shelf marks checked.

## Tokens — landing page (Persuade)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--field` | `#2140b8` | `#172d85` | carbon-copy blue ground (the page) |
| `--paper` / `--paper-2` | `#f4f7ff` / `#dfe6fa` | `#cdd6ef` / `#b4c1e6` | bond-paper slips / carbon duplicate, code wells |
| `--ink` | `#15297a` | `#10236b` | printed form ink: headings, labels, rules' text, primary button |
| `--type` | `#191d2b` | `#141826` | typewritten fill-ins and body on paper |
| `--rule` | `#a3b3e8` | `#8495cf` | form rules, perforations |
| `--stamp` | `#d1203a` | `#b81a31` | the rubber stamp and CHECKED impressions — **only** those |
| `--on-field` / `--on-field-dim` | `#f4f7ff` / `#cdd7ff` | `#eef1ff` / `#c3cff8` | text set directly on the blue field |

Dark mode keeps the world: a deeper carbon blue, dimmed paper, dark ink (never a dark slate hero).

Type: display **Archivo** (width 105–118%, weight 800–850, tracking −0.02 to −0.035em); form labels
Archivo condensed (75%) caps, letter-spaced 0.09em; body **Public Sans**; fill-ins, commands, shelf marks
and ledger numbers **Courier Prime**. Scale: 0.875 / 1 / 1.25 / 1.6 / clamp(1.9–2.75) / clamp(2.4–4.6) rem.

## Components
- **Slip**: paper, 3px radius, soft offset shadow; ruled `dl` fields (label column 10.5rem, stacked < 560px).
- **Tear-off stub**: 2px dashed perforation with two punched notches in the field colour; holds the action.
- **Stamp**: double 3px rule, condensed caps, tabular number, −4° rotation, multiply blend, ink-noise
  mask (`--ink-mask`, SVG feTurbulence) and a displaced edge (`#ink-edge`). Presses once on change
  (300 ms ease-out; none under reduced motion).
- **CHECKED impression**: the stamp's grammar at text size beside each verified `path:Lx` mark.
- **Ledger / register**: tables on slips; condensed-caps heads over a 2px ink rule; typewritten numbers;
  form numbers ("Form HO-2 · Circulation record") printed bottom-right; stacked labelled records on phones.
- **Buttons**: ink fill on paper; pill toggles for request kinds; native `select` styled with an ink border.

## Tokens — report (Operate, offline)

| Token | Light | Dark |
|---|---|---|
| `--shell` (header band) | `#2140b8` | `#1c379f` |
| `--bg` / `--panel` | `#eef1f9` / `#fbfcff` | `#0b1230` / `#141c40` |
| `--line` / `--grid` | `#d6ddef` / `#e3e8f5` | `#2a3566` / `#1f2a55` |
| `--text` / `--text-2` | `#161a26` / `#4a5373` | `#e9edff` / `#a7b2dc` |
| `--accent` (bars) | `#2140b8` | `#5f79ec` |
| `--ok` / `--bad` / `--warn` | `#1b7348` / `#c81e36` / `#8a5300` | `#2a9f6a` / `#ec4f64` / `#e0a347` |

System UI font stack and `ui-monospace` (no network fonts: the report opens from `file://`); tabular
numerals everywhere. Bars ≤ 24px, 4px rounded data end, square at the baseline; hairline grid; hover
tooltip and a table view. **Stamp chips**: square, 3px double rule, letter-spaced caps with a count, an
authored SVG check/alert icon; green only for verified, red only for failures/unverified.

## Open
- The impeccable direction roll was not run (unattended; its launcher binary was not executed) — the
  owner may run it or accept this direction.
- The stamp's ink is procedural (SVG noise + displacement), not a scanned impression asset.
