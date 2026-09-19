# Design tokens (from Elli UI)

Copied from `elli-ui/src/app/styles/` on 2026-09-13. Source of truth there is
`theme.css` → `themes/{light,editorial,dark,dark-blue}.css`, with `globals.css`
mapping every `--x` variable to a Tailwind v4 `--color-x` inside `@theme inline`,
so the tokens are used as utilities: `bg-primary`, `text-muted-foreground`,
`border-card-border`, `ring-ring`, etc.

**Editorial is the default theme** (`DEFAULT_THEME = 'editorial'` in
`app/theme/theme-registry.ts`). The other three exist behind a theme switcher.
Dark mode is a **class** (`.dark` / `.dark-blue`) toggled by `next-themes`, not a
media query — components never write `dark:` variants over raw colours; they use
the semantic token and the theme file supplies the value.

## Token vocabulary

Every theme defines the same names. Meaning, not colour:

| Group | Tokens |
| --- | --- |
| Surfaces | `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `page-header`, `page-header-border`, `surface-hover` |
| Brand / interactive | `primary`, `primary-hover`, `primary-foreground`, `primary-soft`, `primary-alpha`, `primary-soft-foreground`, `secondary(-foreground)`, `accent(-foreground)`, `muted(-foreground)`, `brand-gold`, `brand-clay` |
| Outline button | `outline-button-{background,foreground,border,hover-background,hover-foreground,hover-border}` |
| Feedback | `success`, `warning`, `info`, `destructive` — each with `-foreground`, `-soft`, `-alpha`, `-accent` (not destructive), `-soft-foreground` |
| Links | `link`, `link-hover` — deliberately separate from `info` and `primary` so retuning one does not recolour the other |
| Charts | `chart-1` … `chart-5` |
| Borders / elevation | `border`, `input-border`, `ring`, `radius`, `separator`, `card-border`, `card-border-hover`, `card-header`, `card-header-foreground`, `table-card-header-foreground`, `left-panel-shadow` |
| App accents | `project-tabs-background`, `header-action-hover-background`, `table-card-tab-accent`, `label-light`, `label-lighter`, `rule-strong` |
| Status | `fieldwire-status-{draft,neutral,pending,approved,rejected}` |
| Sidebar | `sidebar-bg`, `sidebar-foreground`, `sidebar-muted`, `sidebar-border`, `sidebar-hover-foreground`, `sidebar-item-hover`, `sidebar-item-active`, `sidebar-popover-{bg,foreground,muted,border,hover,active}` (+ editorial-only: `sidebar-item-selected`, `sidebar-card{,-hover,-selected,-open}`, `sidebar-submenu-hover`, `sidebar-nav-accent`, `sidebar-nav-link{,-hover}`, `sidebar-paper`) |

Soft/alpha/accent convention: `X` is the fill, `X-foreground` the text on that
fill, `X-soft` a tinted surface, `X-alpha` a slightly stronger tint (borders,
hover on soft), `X-accent` the darker/lighter ink that reads on the soft
surface, `X-soft-foreground` = the accent by default. Contrast on soft surfaces
is tuned for badge-sized text (≥ 4.5:1), not just 3:1.

## Editorial (default) — navy on cream

| Role | Token | Value |
| --- | --- | --- |
| Page background | `--background` | `#faf9f5` + 24px dot grid (`rgba(26,20,16,.022)`) |
| Text | `--foreground` | `#1a1410` |
| Card / popover / page header | `--card`, `--popover`, `--page-header` | `#ffffff` |
| Page header border | `--page-header-border` | `#e2ddd4` |
| Hover surface | `--surface-hover` | `#f1ece2` |
| Muted surface / text | `--muted` / `--muted-foreground` | `#f1ece2` / `#6b6359` |
| **Primary (brand navy)** | `--primary` / `--primary-hover` | `#1a3a5f` / `#112b47` |
| Primary text | `--primary-foreground` | `#fdfbf6` |
| Primary soft / alpha / soft-fg | `--primary-soft` / `--primary-alpha` / `--primary-soft-foreground` | `#ebe7df` / `#d5cfc0` / `#1a3a5f` |
| Secondary | `--secondary` / `--secondary-foreground` | `#ebe7df` / `#112b47` |
| Accent | `--accent` / `--accent-foreground` | `#ebeef3` / `#1a3a5f` |
| Outline button | fg / border / hover-bg / hover-fg / hover-border | `#2f2a24` / `#d8d0c5` / `#f3f1ed` / `#1a1410` / `#cfc6ba` |
| Brand gold | `--brand-gold` | `#e0a94d` |
| Brand clay | `--brand-clay` | `#c75e40` |
| Success | fill / fg / soft / alpha / accent | `teal-600 #0d9488` / `#ffffff` / `teal-50 #f0fdfa` / `teal-200 #99f6e4` / `teal-700 #0f766e` |
| Warning | fill / fg / soft / alpha / accent | `#b8860b` / `#f7efd9` / `#f7efd9` / `#ead7a5` / `amber-800 #92400e` |
| Info | fill / fg / soft / alpha / accent | `#0e7490` / `#fdfbf6` / `sky-50 #f0f9ff` / `sky-200 #bae6fd` / `sky-700 #0369a1` |
| Link | `--link` / `--link-hover` | `#0e7490` / `#155e75` (5.36:1 on card, 5.09:1 on page) |
| Destructive | fill / fg / soft / alpha / soft-fg | `#dc2626` / `#ffffff` / `#fbe8e8` / `#f3c2c2` / `#b91c1c` |
| Border / input border / ring | `--border` / `--input-border` / `--ring` | `#d5cfc0` / `#d8d0c5` / `#1a3a5f` |
| Card border / hover | `--card-border` / `--card-border-hover` | `#d5cfc0` / `#c5bfb0` |
| Card header | `--card-header` / `--card-header-foreground` | `#183450` (sidebar bg) / `#ffffff` |
| Table card header text | `--table-card-header-foreground` | `#fdfbf6` |
| Radius | `--radius` | `0.5rem` |
| Separator | `--separator` | `lab(96.1634 0.0993311 -0.364041)` |
| Rule (strong) | `--rule-strong` | `#ddd7cc` |
| Labels | `--label-light` / `--label-lighter` | `lab(47.8878 1.65477 -5.77283)` / `lab(35.1166 1.78212 -6.1173)` |
| Left panel shadow | `--left-panel-shadow` | `-4px 0 16px rgba(0,0,0,.06), -1px 0 4px rgba(0,0,0,.04)` |
| Project tabs bg | `--project-tabs-background` | `#ffffff` |
| Header action hover | `--header-action-hover-background` | `#ebeef3` |
| Table tab accent | `--table-card-tab-accent` | `#e0a94d` |
| Charts 1–5 | `--chart-1..5` | `#1a3a5f` `#2d6a4f` `#b8860b` `#c75e40` `#6b6359` |
| Status draft / neutral / pending / approved / rejected | `--fieldwire-status-*` | `#b8860b` `#9a9286` `#1a3a5f` `#2d6a4f` `#dc2626` |

### Editorial sidebar (dark navy)

| Token | Value |
| --- | --- |
| `--sidebar-bg` | `#183450` |
| `--sidebar-foreground` | `#c2c9d2` |
| `--sidebar-muted` | `#a7b2c0` |
| `--sidebar-border` | `#405a77` |
| `--sidebar-hover-foreground` | `#f1f3f5` |
| `--sidebar-item-hover` / `--sidebar-item-active` | `#284562` |
| `--sidebar-item-selected` | `#2d4b6c` |
| `--sidebar-card` / `-hover` / `-selected` / `-open` | `#203b59` / `#274463` / `#2d4b6c` / `#1b3551` |
| `--sidebar-submenu-hover` | `#142b43` |
| `--sidebar-nav-accent`, `--sidebar-nav-link`, `--sidebar-nav-link-hover` | `#ffda8f` (gold) |
| `--sidebar-paper` | `#faf9f5` |
| `--sidebar-popover-bg` | `#183450` |
| `--sidebar-popover-foreground` | `#ffffff` |
| `--sidebar-popover-muted` | `rgba(255,255,255,.62)` |
| `--sidebar-popover-border` | `rgba(255,255,255,.12)` |
| `--sidebar-popover-hover` / `-active` | `rgba(255,255,255,.08)` / `rgba(255,255,255,.14)` |

### Editorial typography

| Use | Stack |
| --- | --- |
| Body / UI | `'Public Sans', 'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` |
| Headings (`h1`–`h4`, `.font-serif`) | `'Fraunces', Georgia, serif` |
| `.font-mono` | `'DM Mono', 'IBM Plex Sans', monospace` |
| Code blocks | `'IBM Plex Mono', 'DM Mono', monospace` |

Non-editorial themes use `'IBM Plex Sans', system-ui, …` for everything.

## Light — emerald on zinc

| Role | Value |
| --- | --- |
| Background / foreground | `#f5f5f5` / `zinc-950` |
| Card / popover / page header | `white`; header border `#e5e5e5` |
| Surface hover | `zinc-50` |
| Primary / hover / fg | `emerald-600 #059669` / `emerald-700 #047857` / `white` |
| Primary soft / alpha / soft-fg | `emerald-50` / `emerald-100` / `emerald-700` |
| Secondary, accent, muted | `zinc-100`; fg `zinc-900`; muted-fg `zinc-500` |
| Brand gold / clay | `amber-500` / `orange-600` |
| Success | `emerald-600` / soft `emerald-50` / alpha `emerald-200` / accent `emerald-700` |
| Warning | `amber-500` / fg `amber-950` / soft `amber-50` / alpha `amber-200` / accent `amber-700` |
| Info | `#0e7490` / soft `sky-50` / alpha `sky-200` / accent `sky-700` |
| Link / hover | `#0e7490` / `#155e75` |
| Destructive | `red-600` / soft `red-50` / alpha `red-100` / soft-fg `red-700` |
| Border / input / ring | `oklch(94% 0.004 286.32)` / `zinc-300` / `zinc-400` |
| Card border / hover | `#e4e4e7` / `#d4d4d8` |
| Card header | `slate-50` / fg `zinc-950` |
| Charts 1–5 | `blue-500` `green-500` `yellow-500` `red-500` `purple-500` |
| Status | `amber-500` `slate-400` `blue-500` `emerald-500` `red-500` |
| Project tabs bg / rule-strong | `#f8f9fa` / `#d4d4d8` |
| Sidebar | bg `#191919`, fg `#e4e4e7`, muted `#a1a1aa`, border `#27272a`, hover-fg `green-400`, item hover `rgba(255,255,255,.08)`, active `#2f2f2f`, popover bg `#191919`, popover fg `#f4f4f5`, popover border `#3f3f46`, popover hover/active `#27272a` |

## Dark (black)

| Role | Value |
| --- | --- |
| Background / foreground | `#0f0f0f` / `zinc-50` |
| Card / page header | `#141414`; header border `zinc-800`; popover `oklch(14.43% 0.005 200)` |
| Surface hover, secondary, accent, muted | `zinc-800`; muted-fg `zinc-400` |
| Primary / hover / fg | `#4f7da8` / `#6d97c0` / `#0f0f0f` |
| Primary soft / alpha / soft-fg | `zinc-900` / `zinc-800` / `#6d97c0` |
| Brand gold / clay | `amber-300` / `#c75e40` |
| Success | `emerald-500` / fg `emerald-950` / soft `emerald-950` / alpha `emerald-900` / accent `emerald-400` |
| Warning | `amber-400` / fg `amber-950` / soft `amber-950` / alpha `amber-900` / accent `amber-300` |
| Info | `#0891b2` / fg `#0f0f0f` / soft `blue-950` / alpha `blue-900` / accent `blue-400` |
| Link / hover | `#22d3ee` / `#67e8f9` |
| Charts 1–5 | `blue-500` `green-500` `yellow-500` `red-500` `purple-500` |
| Sidebar | same as Light except hover-fg `#c75e40` |

## Dark-blue (navy-tinted dark)

| Role | Value |
| --- | --- |
| Background / foreground | `#0a0f1a` / `#f1f5f9` |
| Card / popover / page header | `#0f1624`; header border `#1e293b` |
| Surface hover, secondary, accent, muted | `#162033`; secondary/accent fg `#e2e8f0`; muted-fg `#94a3b8` |
| Primary / hover / fg | `#60a5fa` / `#93c5fd` / `#0a0f1a` |
| Primary soft / alpha / soft-fg | `rgba(96,165,250,.12)` / `rgba(96,165,250,.25)` / `#93c5fd` |
| Brand gold / clay | `#fbbf24` / `#f97316` |
| Success | `#4ade80` / fg `#0a0f1a` |

## Paste-ready: Editorial tokens as CSS

```css
:root {
  color-scheme: light;

  /* Surfaces */
  --background: #faf9f5;
  --foreground: #1a1410;
  --card: #ffffff;
  --card-foreground: #1a1410;
  --page-header: #ffffff;
  --page-header-border: #e2ddd4;
  --popover: #ffffff;
  --popover-foreground: #1a1410;
  --surface-hover: #f1ece2;

  /* Brand / interactive */
  --primary: #1a3a5f;
  --primary-hover: #112b47;
  --primary-foreground: #fdfbf6;
  --primary-soft: #ebe7df;
  --primary-alpha: #d5cfc0;
  --primary-soft-foreground: #1a3a5f;
  --secondary: #ebe7df;
  --secondary-foreground: #112b47;
  --accent: #ebeef3;
  --accent-foreground: #1a3a5f;
  --outline-button-background: transparent;
  --outline-button-foreground: #2f2a24;
  --outline-button-border: #d8d0c5;
  --outline-button-hover-background: #f3f1ed;
  --outline-button-hover-foreground: #1a1410;
  --outline-button-hover-border: #cfc6ba;
  --muted: #f1ece2;
  --muted-foreground: #6b6359;
  --brand-gold: #e0a94d;
  --brand-clay: #c75e40;

  /* Feedback */
  --success: #0d9488;
  --success-foreground: #ffffff;
  --success-soft: #f0fdfa;
  --success-alpha: #99f6e4;
  --success-accent: #0f766e;
  --success-soft-foreground: var(--success-accent);
  --warning: #b8860b;
  --warning-foreground: #f7efd9;
  --warning-soft: #f7efd9;
  --warning-alpha: #ead7a5;
  --warning-accent: #92400e;
  --warning-soft-foreground: var(--warning-accent);
  --info: #0e7490;
  --info-foreground: #fdfbf6;
  --info-soft: #f0f9ff;
  --info-alpha: #bae6fd;
  --info-accent: #0369a1;
  --info-soft-foreground: var(--info-accent);
  --link: #0e7490;
  --link-hover: #155e75;
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;
  --destructive-soft: #fbe8e8;
  --destructive-alpha: #f3c2c2;
  --destructive-soft-foreground: #b91c1c;

  /* Charts */
  --chart-1: #1a3a5f;
  --chart-2: #2d6a4f;
  --chart-3: #b8860b;
  --chart-4: #c75e40;
  --chart-5: #6b6359;

  /* Borders, inputs, elevation */
  --border: #d5cfc0;
  --input-border: #d8d0c5;
  --ring: #1a3a5f;
  --radius: 0.5rem;
  --separator: lab(96.1634 0.0993311 -0.364041);
  --card-border: #d5cfc0;
  --card-border-hover: #c5bfb0;
  --card-header: var(--sidebar-bg);
  --card-header-foreground: #fff;
  --table-card-header-foreground: #fdfbf6;
  --left-panel-shadow: -4px 0 16px rgba(0, 0, 0, 0.06), -1px 0 4px rgba(0, 0, 0, 0.04);

  /* App accents */
  --project-tabs-background: #ffffff;
  --header-action-hover-background: #ebeef3;
  --table-card-tab-accent: #e0a94d;
  --label-light: lab(47.8878 1.65477 -5.77283);
  --label-lighter: lab(35.1166 1.78212 -6.1173);
  --rule-strong: #ddd7cc;

  /* Status */
  --fieldwire-status-draft: #b8860b;
  --fieldwire-status-neutral: #9a9286;
  --fieldwire-status-pending: #1a3a5f;
  --fieldwire-status-approved: #2d6a4f;
  --fieldwire-status-rejected: #dc2626;

  /* Sidebar */
  --sidebar-bg: #183450;
  --sidebar-foreground: #c2c9d2;
  --sidebar-muted: #a7b2c0;
  --sidebar-border: #405a77;
  --sidebar-hover-foreground: #f1f3f5;
  --sidebar-item-hover: #284562;
  --sidebar-item-active: #284562;
  --sidebar-item-selected: #2d4b6c;
  --sidebar-card: #203b59;
  --sidebar-card-hover: #274463;
  --sidebar-card-selected: #2d4b6c;
  --sidebar-card-open: #1b3551;
  --sidebar-submenu-hover: #142b43;
  --sidebar-nav-accent: #ffda8f;
  --sidebar-paper: #faf9f5;
  --sidebar-nav-link: #ffda8f;
  --sidebar-nav-link-hover: #ffda8f;
  --sidebar-popover-bg: var(--sidebar-bg);
  --sidebar-popover-foreground: #ffffff;
  --sidebar-popover-muted: rgba(255, 255, 255, 0.62);
  --sidebar-popover-border: rgba(255, 255, 255, 0.12);
  --sidebar-popover-hover: rgba(255, 255, 255, 0.08);
  --sidebar-popover-active: rgba(255, 255, 255, 0.14);
}

body {
  font-family:
    'Public Sans', 'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  background-color: var(--background);
  background-image: radial-gradient(circle at 1px 1px, rgba(26, 20, 16, 0.022) 1px, transparent 0);
  background-size: 24px 24px;
  color: var(--foreground);
}

h1, h2, h3, h4, .font-serif { font-family: 'Fraunces', Georgia, serif; }
.font-mono { font-family: 'DM Mono', 'IBM Plex Sans', monospace; }
```

### Tailwind v4 mapping (excerpt of `globals.css`)

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary-soft: var(--primary-soft);
  --color-primary-alpha: var(--primary-alpha);
  --color-primary-soft-foreground: var(--primary-soft-foreground);
  --color-success: var(--success);
  /* …same pattern for every token above… */
  --color-sidebar-bg: var(--sidebar-bg);
  --color-card-border: var(--card-border);
}
```
