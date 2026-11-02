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

Layout: the "Standard" report the owner chose on 2026-11-02. Colour and type: the landing page's ("Now"),
as the owner asked the same day ("the colour and the fonts from the Now edition, keep the rest the same").
Light by default, dark by `prefers-color-scheme` or `data-theme="dark"`. The three typefaces are embedded
as latin subsets (about 72 KB of woff2, base64) so the file still opens from `file://` with no network.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--shell` / `--on-shell` / `--on-shell-2` | `#2140b8` / `#f4f7ff` / `#cdd7ff` | `#1c379f` / `#eef1ff` / `#c3cff8` | the carbon-blue top bar, its title, its meta line and the period switch |
| `--bg` / `--panel` / `--raise` | `#eef1f9` / `#fbfcff` / `#ffffff` | `#0b1230` / `#141c40` / `#1b2550` | ground, cards and panels, tooltip and code wells |
| `--line` / `--grid` / `--guide` | `#d6ddef` / `#e3e8f5` / `#9aa4c6` | `#2a3566` / `#1f2a55` / `#4d5a8f` | hairlines, chart grid, hover guide line |
| `--text` / `--text-2` / `--text-3` / `--cell` | `#161a26` / `#4a5373` / `#5c6585` / `#262c40` | `#e9edff` / `#a7b2dc` / `#8c97c3` / `#d3d9f3` | headings and figures / labels / hints and axes (≥5.1:1 on panels) / table cells |
| `--accent` | `#2140b8` | `#5f79ec` | the chart series (line, area gradient 20% light / 32% dark → 0, end dot), focus ring |
| `--ok` / `--bad` / `--warn` | `#1b7348` / `#c81e36` / `#8a5300` | `#3cb47c` / `#f06a7c` / `#e0a347` | verified / failed or unverified / the "Example data" label only |

Dark `--ok` and `--bad` are the landing page's hues lifted slightly (from `#2a9f6a` / `#ec4f64`) so pill
text stays above 4.5:1 on its 10% tint.

Type: Archivo (800, `font-stretch` 112%) for the report title, 750/105% for panel headings, 800 for the
summary figures; Public Sans for text, labels, tables and axes; Courier Prime for model ids, commands and
code. Tabular numerals everywhere. Figures 1.85rem, tracking −0.02em. Cards and panels: 12px radius, 1px
hairline, no shadow. Period switch: segmented control on the blue bar, 8px outer radius, active segment
`--on-shell` with `--shell` text. Chart: area + 2px line, round
y-axis steps (0, 50K, 100K…), 300px tall from 900px wide (240px below); hover shows a guide line,
a ring marker and a tooltip beside the line (flipped near the right edge); keyboard focus draws the
guide in the accent instead of an outline; the unfinished current hour/day/week is a dashed last segment and
reads "so far"; date labels are counted back from now. 120ms fades on guide, marker and tooltip; nothing
else moves. "Show as a table" gives the same numbers. Status: pills (999px radius) tinted 10% in their
state colour with a matching border and an authored check or alert icon. Phone: the latest delegations
become stacked records (time + kind, what, model, "N kept", time, citations); model ids break only after
"/" or ":".

## Open
- Direction round 2026-11-02 (impeccable's launcher blocked here; its fallback process was followed): the
  owner kept the landing page's world and chose the "Standard" report for the dashboard. The concept-seed
  roll itself was never run; run it where the launcher works if a seeded record is wanted.
- The stamp's ink is procedural (SVG noise + displacement), not a scanned impression asset.
