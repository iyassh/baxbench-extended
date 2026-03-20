# BaxBench Security Dashboard — Redesign

## Overview

Redesign the BaxBench Security Dashboard from a basic shadcn template into a polished, modern analytics tool. Linear/Vercel aesthetic with dark theme, full interactivity, animated charts, and auto-generated insights. 13 model configs, 3,276 test results, deep drill-down capability.

## Design Direction

**Aesthetic:** Clean modern SaaS — Linear meets Vercel. Dark-first, sharp typography, generous whitespace, smooth animations.

**Story:** The dashboard tells three stories — (1) which model is most secure, (2) safety prompts matter, (3) here are the vulnerabilities — with drill-down for each.

**Interactivity:** Full — tooltips, clickable charts, animated transitions, filterable data, command palette, slide-out panels.

## Global Design System

### Theme

Dark-first, no light mode.

- Background: `#09090b` (zinc-950)
- Card surfaces: `#18181b` (zinc-900)
- Borders: `#27272a` (zinc-800)
- Text: white / zinc-400 for muted

### Typography

Inter font. Large bold headings, medium weight labels, tabular numbers for data.

### Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Emerald | `#10b981` | Secure / pass / good |
| Red | `#ef4444` | Vulnerable / fail / CWEs |
| Amber | `#f59e0b` | Warnings / partial |
| Blue | `#3b82f6` | Neutral data / info |
| Purple | `#8b5cf6` | Thinking mode accent |
| Zinc grays | various | Borders, muted text, surfaces |

### Cards

Subtle zinc-800 border, slight background elevation, rounded-xl. No heavy shadows.

### Animations (framer-motion)

- Page transitions: fade + slight slide up
- Chart elements animate in on mount
- Counters count up from 0
- Hover: subtle lift + border glow on cards
- Skeleton loaders while data loads

### Navigation

Minimal top bar: logo + 4 page links (Overview, Models, Vulnerabilities, Compare). Active state with pill indicator. Command palette (Cmd+K) for jumping to any model/CWE/scenario.

## Pages

### 1. Overview (The Hero Page)

Top-to-bottom scroll, tells the full story:

**Header**
- "BaxBench Security Dashboard"
- Tagline with animated counters: "13 model configurations / 3,276 test results"

**Key Insights Bar**
- 3-4 auto-generated insight pills pulled from data
- Examples: "Opus 4.6 thinking is the most secure model (XX% sec_pass@1)", "Thinking mode reduces CWEs by XX%", "Specific safety prompts improve security by XX%"
- Click scrolls to relevant chart
- Staggered fade-in animation

**Stat Cards (4)**
- Total Results (animated counter)
- Models Tested (mini donut: thinking vs standard)
- Average sec_pass@1 (sparkline across models)
- Total CWEs Found (red accent, mini bar of top 3)
- Subtle hover glow

**Model Ranking Chart**
- Horizontal bar chart, all 13 models ranked by sec_pass@1
- Color-coded by family (Haiku=gray, Sonnet=blue, Opus=purple)
- Thinking variants get stripe pattern
- Hover: full stats tooltip. Click: navigate to model detail

**Vulnerability Heatmap (visual centerpiece)**
- Model (y) x Scenario (x) grid
- Color intensity = CWE count (red=many, green=clean)
- Hover: exact counts. Click: drill into model+scenario combo

**Safety Prompt Impact Chart**
- Grouped bar chart: sec_pass@1 for none/generic/specific per model
- Animated on scroll into view

**Quick Links**
- Clickable CWE badges sized by frequency, linking to Vulnerabilities page

### 2. Models Page

**Filter Bar (sticky)**
- Family: All / Haiku / Sonnet / Opus (pill buttons)
- Mode: All / Standard / Thinking
- Sort: sec_pass@1 / pass@1 / CWE count / Name
- Filters animate grid with layout transitions

**Model Cards Grid (2-3 per row)**
Each card shows:
- Model name + family badge (color-coded)
- Thinking/Standard pill
- Mini donut: pass@1 vs fail
- sec_pass@1 % (large, color-coded green to red)
- CWE count with top 3 bar breakdown
- Sparkline: sec_pass@1 across 3 safety prompts

**Model Detail Panel (slide-in from right)**
Click a card to open:
- Full stats row
- Radar chart: 6 axes (functional pass, security pass, CWEs per framework x3, safety prompt responsiveness)
- Safety prompt breakdown: 3 mini bars (none/generic/specific)
- Top CWEs table: ranked, expandable to show triggering scenarios
- Results table: sortable, expandable rows with code viewer + test logs

### 3. Vulnerabilities Page

**Header Stats (3 cards)**
- Total unique CWEs (Original vs Extended split)
- Most common CWE (name + count, red accent)
- Most vulnerable scenario (name + CWE count)

**CWE Treemap**
- Each rectangle = a CWE, sized by occurrences
- Color intensity = number of affected models
- Hover: name + count + worst model. Click: drill in

**Filter Bar**
- Type: All / Original / Extended
- Search: type-ahead by CWE name or number
- Sort: frequency / affected models / CWE number

**CWE List (expandable cards)**
Each CWE card:
- Number + name + MITRE link
- Occurrence bar (proportional horizontal)
- Worst → Best model badges
- Original/Extended badge

Expand to see:
- Model breakdown (horizontal bars per model)
- Scenario breakdown
- Framework breakdown (Flask/Express/Fiber)

**CWE x Model Matrix**
- Heatmap: top 15 CWEs (y) x Models (x)
- Hover for counts, click to drill in

### 4. Compare Page

**Comparison Mode Selector**
Large toggle pills: Safety Prompts / Thinking vs Standard / Frameworks / Model Families. Content transitions with framer-motion.

**Safety Prompts Mode**
- Grouped bar chart: 3 bars per model (none/generic/specific), amber/blue/emerald
- Delta table: % improvement none→generic, generic→specific. Green arrows up, red down
- Auto-generated insight callout

**Thinking vs Standard Mode**
- Paired horizontal bars per model family
- Radar chart overlay: standard vs thinking across dimensions
- Delta table: % difference per family

**Frameworks Mode**
- Stacked bar chart: Flask/Express/Fiber segments per model
- Expandable table per framework showing vulnerable scenarios

**Model Families Mode**
- Box plot / violin chart: sec_pass@1 distribution per family
- Summary cards: one per family with averages + best/worst config

## Shared Components

### Slide-out Panel
- Right-side, 60% width
- Code viewer (dark syntax highlighting, tabs, copy, line numbers)
- Test logs viewer
- Esc or click outside to close

### Command Palette (Cmd+K)
- Search models, CWEs, scenarios
- Recent items, categorized results
- Keyboard navigable

### Tooltips
- Rich context (not just numbers)
- Consistent dark style with arrow

### Loading States
- Skeleton loaders matching layout shape
- Staggered chart fade-in
- Counter animations (0 → value, ~1s)

### Responsive
- Desktop-first
- Cards: 3-col → 2-col → 1-col
- Wide charts: horizontal scroll on small screens

## Tech Stack

### Keep
- Next.js 16 (App Router, Server Components)
- React 19
- better-sqlite3 (read-only)
- recharts (bar, radar, treemap, heatmap)
- shadcn/ui (customize theme tokens)
- Tailwind CSS v4
- react-syntax-highlighter

### Add
- **framer-motion** — page transitions, layout animations, scroll triggers
- **cmdk** — command palette
- Possibly **nivo** or **visx** if recharts can't handle treemap/heatmap well

## Data Layer Changes

### New queries needed
- `getInsights()` — compute auto-generated insight strings from data
- `getHeatmapData()` — model x scenario CWE matrix
- `getModelRadarData(config)` — multi-axis data for radar chart
- `getCweTreemapData()` — CWE occurrences + affected model counts
- `getDeltaComparison(dimension)` — % changes between safety prompts / thinking modes
- `getDistributionByFamily()` — sec_pass@1 distributions for box plots
