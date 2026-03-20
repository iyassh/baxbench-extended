# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the BaxBench Security Dashboard into a polished, dark-themed analytics tool with full interactivity, animated charts, and auto-generated insights.

**Architecture:** Dark-first Next.js 16 app using Server Components for data, Client Components for interactivity. framer-motion for animations, recharts for charts, cmdk for command palette, shadcn/ui for primitives. 4-page structure: Overview, Models, Vulnerabilities, Compare. Slide-out panels instead of deep page navigation.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, shadcn/ui, recharts, framer-motion, cmdk, better-sqlite3

---

## Phase 1: Foundation (Theme, Layout, Dependencies)

### Task 1: Install new dependencies

**Files:**
- Modify: `dashboard/package.json`

**Step 1: Install framer-motion and cmdk**

```bash
cd dashboard && npm install framer-motion cmdk
```

**Step 2: Verify installation**

```bash
npm ls framer-motion cmdk
```

Expected: Both packages listed with versions.

**Step 3: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json
git commit -m "feat: add framer-motion and cmdk dependencies"
```

---

### Task 2: Dark theme and design tokens

**Files:**
- Modify: `dashboard/app/globals.css`

**Step 1: Replace globals.css with dark-only theme**

Replace the entire theme section in globals.css with a dark-only design system using the color palette from the design doc:
- Background: zinc-950 (`#09090b`)
- Card surfaces: zinc-900 (`#18181b`)
- Borders: zinc-800 (`#27272a`)
- Semantic colors: emerald (pass), red (fail), amber (warning), blue (info), purple (thinking)
- Chart colors mapped to the semantic palette
- Remove all light mode variables
- Add `dark` class to root by default

Key CSS variables to define:
```
--background: 0 0% 3.9%
--foreground: 0 0% 98%
--card: 0 0% 5.9%
--card-foreground: 0 0% 98%
--primary: 142 71% 45%  (emerald)
--destructive: 0 84% 60% (red)
--warning: 38 92% 50%   (amber)
--info: 217 91% 60%     (blue)
--accent-purple: 258 90% 66% (purple/thinking)
--chart-pass: 142 71% 45%
--chart-fail: 0 84% 60%
--chart-warning: 38 92% 50%
--chart-info: 217 91% 60%
--chart-purple: 258 90% 66%
```

**Step 2: Update layout.tsx to force dark mode**

Add `dark` class to `<html>` element and update the background:
```tsx
<html lang="en" className="dark">
  <body className={cn(inter.className, "bg-background text-foreground antialiased")}>
```

**Step 3: Verify build**

```bash
cd dashboard && npm run build
```

**Step 4: Commit**

```bash
git add dashboard/app/globals.css dashboard/app/layout.tsx
git commit -m "feat: dark-only theme with security-focused color palette"
```

---

### Task 3: New navigation component

**Files:**
- Modify: `dashboard/components/nav.tsx`

**Step 1: Rewrite nav with 4-page structure and pill indicators**

Update the nav links to: Overview, Models, Vulnerabilities, Compare. Add:
- Logo/title on the left
- Pill-style active indicator using framer-motion `layoutId` for smooth transitions
- Cmd+K trigger button on the right (just the button, palette comes in Task 5)
- Sticky positioning
- Subtle bottom border with zinc-800

Links array:
```typescript
const links = [
  { href: "/", label: "Overview" },
  { href: "/models", label: "Models" },
  { href: "/vulnerabilities", label: "Vulnerabilities" },
  { href: "/compare", label: "Compare" },
];
```

**Step 2: Verify it renders**

```bash
cd dashboard && npm run dev
```

Visit localhost:3000, confirm nav renders with 4 links and active pill animates.

**Step 3: Commit**

```bash
git add dashboard/components/nav.tsx
git commit -m "feat: redesigned nav with pill indicators and 4-page structure"
```

---

### Task 4: Layout wrapper with page transitions

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Create: `dashboard/components/page-transition.tsx`

**Step 1: Create page transition wrapper**

A client component using framer-motion `AnimatePresence` and `motion.div`:
- Fade in + slight slide up on page mount
- Duration ~300ms, ease out

```tsx
"use client";
import { motion } from "framer-motion";

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
```

**Step 2: Update layout.tsx to use it**

Wrap `{children}` in `<PageTransition>`.

**Step 3: Verify transitions work**

Navigate between pages, confirm fade-in animation.

**Step 4: Commit**

```bash
git add dashboard/components/page-transition.tsx dashboard/app/layout.tsx
git commit -m "feat: page transition animations with framer-motion"
```

---

### Task 5: Command palette

**Files:**
- Create: `dashboard/components/command-palette.tsx`
- Modify: `dashboard/app/layout.tsx`

**Step 1: Create command palette component**

Client component using `cmdk` package:
- Triggered by Cmd+K (or the nav button)
- Searches across: model configs (from `/api/search` or inline data), CWE numbers/names, scenarios
- Groups results by category: Models, CWEs, Scenarios
- Keyboard navigable, Esc to close
- Dark styled dialog overlay
- On select, navigate with `router.push()`

Data: Pass a serialized list of all searchable items from layout's server component as a prop.

**Step 2: Wire into layout**

Import and render `<CommandPalette items={searchItems} />` in layout.tsx. Server component fetches items from DB (all configs, CWEs, scenarios) and passes as JSON prop.

**Step 3: Test Cmd+K**

Press Cmd+K, type "opus", confirm it filters to opus models. Select one, confirm navigation.

**Step 4: Commit**

```bash
git add dashboard/components/command-palette.tsx dashboard/app/layout.tsx
git commit -m "feat: command palette with Cmd+K for quick navigation"
```

---

## Phase 2: Shared Components

### Task 6: Animated stat card

**Files:**
- Modify: `dashboard/components/stat-card.tsx`

**Step 1: Rewrite stat card with animated counter and optional extras**

Props:
- `title: string`
- `value: number | string`
- `subtitle?: string`
- `trend?: "up" | "down" | "neutral"`
- `icon?: ReactNode`
- `accent?: "emerald" | "red" | "amber" | "blue" | "purple"`
- `miniChart?: ReactNode` (slot for sparkline/donut)

Features:
- Animated counter using framer-motion `useMotionValue` + `useTransform` for numbers
- Hover: subtle border glow matching accent color
- Card background: zinc-900 with zinc-800 border
- Value uses tabular-nums font feature

**Step 2: Verify with hardcoded data**

Render a few stat cards on the overview page with different accents and values.

**Step 3: Commit**

```bash
git add dashboard/components/stat-card.tsx
git commit -m "feat: animated stat cards with counters and accent colors"
```

---

### Task 7: Slide-out panel

**Files:**
- Create: `dashboard/components/slide-panel.tsx`

**Step 1: Create slide-out panel**

Client component:
- Props: `open: boolean`, `onClose: ()=>void`, `title: string`, `children: ReactNode`, `width?: string` (default "60%")
- Slides in from right with framer-motion
- Dark overlay behind (click to close)
- Esc key to close
- Header with title + close button
- Scrollable content area
- `createPortal` to render at document body level

**Step 2: Test with placeholder content**

Add a button that opens the panel with some text.

**Step 3: Commit**

```bash
git add dashboard/components/slide-panel.tsx
git commit -m "feat: slide-out panel component for detail views"
```

---

### Task 8: Rich tooltip component

**Files:**
- Create: `dashboard/components/chart-tooltip.tsx`

**Step 1: Create a consistent chart tooltip**

Styled tooltip for recharts custom tooltip prop:
- Dark background (zinc-900) with zinc-700 border
- Rounded-lg, subtle shadow
- Consistent typography
- Supports title + multiple labeled values
- Color dot indicators matching chart colors

**Step 2: Commit**

```bash
git add dashboard/components/chart-tooltip.tsx
git commit -m "feat: consistent dark chart tooltip component"
```

---

### Task 9: Skeleton loaders

**Files:**
- Create: `dashboard/components/skeleton.tsx`

**Step 1: Create skeleton components**

Shimmer-animated placeholder components:
- `SkeletonCard` — stat card shape
- `SkeletonChart` — chart area shape
- `SkeletonTable` — table rows shape
- Uses Tailwind `animate-pulse` with zinc-800/zinc-700 gradient

**Step 2: Commit**

```bash
git add dashboard/components/skeleton.tsx
git commit -m "feat: skeleton loader components"
```

---

## Phase 3: Data Layer

### Task 10: New query functions

**Files:**
- Modify: `dashboard/lib/queries.ts`
- Modify: `dashboard/lib/types.ts`

**Step 1: Add types for new data structures**

Add to types.ts:
```typescript
export interface HeatmapCell {
  model: string;
  scenario: string;
  cwe_count: number;
  total_tests: number;
}

export interface InsightData {
  text: string;
  type: "security" | "comparison" | "vulnerability";
  link?: string;
}

export interface RadarDataPoint {
  axis: string;
  value: number;
}

export interface DeltaRow {
  config: string;
  baseline: number;
  comparison: number;
  delta: number;
  delta_pct: number;
}

export interface CweTreemapItem {
  name: string;
  cwe_num: number;
  occurrences: number;
  affected_models: number;
}

export interface FamilyDistribution {
  family: string;
  configs: string[];
  values: number[];
  median: number;
  min: number;
  max: number;
}
```

**Step 2: Add query functions**

Add to queries.ts:

- `getInsights(): InsightData[]` — Compute key findings:
  - Best/worst model by sec_pass@1
  - Average CWE reduction from thinking mode
  - Safety prompt impact percentage
  - Most common CWE

- `getHeatmapData(): HeatmapCell[]` — SQL query joining results and result_cwes, grouped by config name and scenario

- `getModelRadarData(configName: string): RadarDataPoint[]` — 6 axes: functional_pass_rate, sec_pass_rate, flask_sec_rate, express_sec_rate, fiber_sec_rate, safety_prompt_responsiveness

- `getCweTreemapData(): CweTreemapItem[]` — CWE occurrences + count of distinct affected configs

- `getSafetyPromptDelta(): DeltaRow[]` — For each config: sec_pass@1 with none vs specific, compute delta

- `getThinkingDelta(): DeltaRow[]` — For each model family: standard vs thinking sec_pass@1 delta

- `getDistributionByFamily(): FamilyDistribution[]` — Group configs by family (haiku/sonnet/opus), collect sec_pass@1 values

- `getSearchItems()` — Return all configs, CWEs, scenarios for command palette

**Step 3: Verify queries work**

```bash
cd dashboard && npm run build
```

No type errors.

**Step 4: Commit**

```bash
git add dashboard/lib/queries.ts dashboard/lib/types.ts
git commit -m "feat: new query functions for heatmap, insights, radar, treemap, deltas"
```

---

## Phase 4: Overview Page

### Task 11: Overview page — header and insights

**Files:**
- Modify: `dashboard/app/page.tsx`

**Step 1: Rewrite the overview page header**

- "BaxBench Security Dashboard" as large heading
- Animated tagline with counters: "13 model configurations / 3,276 test results"
- Insight pills bar below: 3-4 auto-generated insights from `getInsights()`
- Each pill: subtle colored background, staggered animation on mount
- Clickable — smooth scroll to relevant section via `id` anchors

**Step 2: Verify**

```bash
cd dashboard && npm run dev
```

Check overview page shows header + insight pills.

**Step 3: Commit**

```bash
git add dashboard/app/page.tsx
git commit -m "feat: overview header with animated counters and insight pills"
```

---

### Task 12: Overview page — stat cards

**Files:**
- Modify: `dashboard/app/page.tsx`

**Step 1: Add 4 stat cards**

Using the new `StatCard` component:
1. Total Results — emerald accent, animated counter
2. Models Tested — blue accent, with mini text "X thinking / Y standard"
3. Average sec_pass@1 — computed from all configs, amber accent
4. Total CWEs — red accent, with mini text showing top CWE name

Data from `getAllConfigs()` and `getCwesWithStats()`.

**Step 2: Commit**

```bash
git add dashboard/app/page.tsx
git commit -m "feat: overview stat cards with animated counters"
```

---

### Task 13: Model ranking chart

**Files:**
- Create: `dashboard/components/charts/model-ranking-chart.tsx`
- Modify: `dashboard/app/page.tsx`

**Step 1: Create horizontal bar chart**

Client component ("use client") with recharts `BarChart` + `Bar`:
- Horizontal layout (layout="vertical")
- All 13 models sorted by sec_pass@1
- Color-coded by model family: Haiku=zinc-500, Sonnet=blue-500, Opus=purple-500
- Thinking variants: slightly lighter shade or stripe pattern
- Custom tooltip showing: model name, sec_pass@1, pass@1, CWE count
- Animate bars on mount with framer-motion wrapper
- Click a bar → navigate to `/models?selected=configName`

**Step 2: Add to overview page**

Import and render below stat cards with section heading "Model Security Ranking".

**Step 3: Commit**

```bash
git add dashboard/components/charts/model-ranking-chart.tsx dashboard/app/page.tsx
git commit -m "feat: model ranking horizontal bar chart"
```

---

### Task 14: Vulnerability heatmap

**Files:**
- Create: `dashboard/components/charts/vulnerability-heatmap.tsx`
- Modify: `dashboard/app/page.tsx`

**Step 1: Create heatmap component**

Client component rendering a CSS grid or SVG-based heatmap:
- Y-axis: 13 model configs
- X-axis: 28 scenarios
- Each cell: colored by CWE count (green=0, yellow=1-2, orange=3-5, red=6+)
- Hover: tooltip with model, scenario, CWE count, framework breakdown
- Click cell: navigate to model detail with scenario filter
- Responsive: horizontal scroll if needed on smaller screens
- Animate cells fading in on mount with stagger

If recharts Treemap doesn't support this well, build with plain divs + CSS grid. The grid approach is simpler and more controllable for a heatmap.

**Step 2: Add to overview page**

Render below the ranking chart with heading "Vulnerability Matrix".

**Step 3: Commit**

```bash
git add dashboard/components/charts/vulnerability-heatmap.tsx dashboard/app/page.tsx
git commit -m "feat: vulnerability heatmap (model x scenario)"
```

---

### Task 15: Safety prompt impact chart

**Files:**
- Modify: `dashboard/components/charts/safety-comparison-chart.tsx`
- Modify: `dashboard/app/page.tsx`

**Step 1: Rewrite the safety comparison chart**

Upgrade existing chart:
- Grouped bar chart: 3 bars per model (none=amber, generic=blue, specific=emerald)
- Sort models by the delta (biggest improvement first)
- Custom tooltip with values for all 3 prompts
- Animate on scroll into view (use framer-motion `whileInView`)
- Section heading: "Safety Prompt Impact"

**Step 2: Add quick link badges**

Below the chart: row of top CWE badges (from `getCwesWithStats()`, top 8), sized proportionally. Link to `/vulnerabilities`.

**Step 3: Commit**

```bash
git add dashboard/components/charts/safety-comparison-chart.tsx dashboard/app/page.tsx
git commit -m "feat: redesigned safety prompt chart with scroll animation"
```

---

## Phase 5: Models Page

### Task 16: Models page with filter bar and card grid

**Files:**
- Create: `dashboard/app/models/page.tsx`
- Create: `dashboard/components/model-card.tsx`
- Create: `dashboard/components/model-filters.tsx`

**Step 1: Create model filters component**

Client component with:
- Family filter: All / Haiku / Sonnet / Opus (pill toggle buttons)
- Mode filter: All / Standard / Thinking
- Sort dropdown: sec_pass@1 / pass@1 / CWE count / Name
- Filters update URL search params for shareable state

**Step 2: Create model card component**

Client component:
- Model name + family color badge
- Thinking/Standard pill
- Large sec_pass@1 % (color graded: >80% green, 50-80% amber, <50% red)
- Mini donut (recharts PieChart, tiny): pass vs fail ratio
- CWE count
- Sparkline: sec_pass@1 across none/generic/specific
- Hover: subtle lift + border glow
- Click: opens detail panel

**Step 3: Create models page**

Server component that fetches all configs. Passes to client wrapper that handles filtering + grid layout with framer-motion `LayoutGroup` for smooth reorder animations.

**Step 4: Verify**

```bash
cd dashboard && npm run dev
```

Visit /models, confirm cards render, filters work, animations smooth.

**Step 5: Commit**

```bash
git add dashboard/app/models/page.tsx dashboard/components/model-card.tsx dashboard/components/model-filters.tsx
git commit -m "feat: models page with filter bar and animated card grid"
```

---

### Task 17: Model detail panel

**Files:**
- Create: `dashboard/components/model-detail.tsx`
- Create: `dashboard/components/charts/radar-chart.tsx`
- Modify: `dashboard/app/models/page.tsx`

**Step 1: Create radar chart**

Client component using recharts `RadarChart`:
- 6 axes: Functional Pass, Security Pass, Flask, Express, Fiber, Safety Responsiveness
- Single model data, filled area with model family color
- Animated on mount

**Step 2: Create model detail component**

Rendered inside `SlidePanel`. Contains:
- Stats row (4 mini stat cards)
- Radar chart
- Safety prompt breakdown (3 mini grouped bars)
- Top CWEs list (expandable cards)
- Results table (sortable, with expandable rows for code/logs)

**Step 3: Wire into models page**

Click a model card → set selected state → open `SlidePanel` with `ModelDetail`.

**Step 4: Commit**

```bash
git add dashboard/components/model-detail.tsx dashboard/components/charts/radar-chart.tsx dashboard/app/models/page.tsx
git commit -m "feat: model detail slide-out panel with radar chart"
```

---

## Phase 6: Vulnerabilities Page

### Task 18: Vulnerabilities page with treemap and CWE list

**Files:**
- Create: `dashboard/app/vulnerabilities/page.tsx`
- Create: `dashboard/components/charts/cwe-treemap.tsx`
- Create: `dashboard/components/cwe-list.tsx`

**Step 1: Create CWE treemap**

Client component using recharts `Treemap`:
- Each rectangle = CWE, sized by occurrence count
- Color intensity = number of affected models (darker red = more models)
- Hover: CWE name + number + count + worst model
- Click: expand that CWE in the list below

**Step 2: Create CWE list component**

Expandable card list (not a plain table):
- Each CWE: number, name, MITRE link, occurrence bar, worst/best model badges
- Expand to reveal: model breakdown bars, scenario breakdown, framework breakdown
- Filter bar: All/Original/Extended, search by name/number, sort options

**Step 3: Create vulnerabilities page**

Server component:
- 3 stat cards at top
- CWE treemap
- Filter bar + CWE list
- CWE x Model mini heatmap at bottom (top 15 CWEs)

**Step 4: Commit**

```bash
git add dashboard/app/vulnerabilities/page.tsx dashboard/components/charts/cwe-treemap.tsx dashboard/components/cwe-list.tsx
git commit -m "feat: vulnerabilities page with treemap and expandable CWE list"
```

---

## Phase 7: Compare Page

### Task 19: Compare page with mode selector

**Files:**
- Create: `dashboard/app/compare/page.tsx` (replace existing)
- Create: `dashboard/components/compare/safety-prompt-tab.tsx`
- Create: `dashboard/components/compare/thinking-tab.tsx`
- Create: `dashboard/components/compare/frameworks-tab.tsx`
- Create: `dashboard/components/compare/families-tab.tsx`

**Step 1: Create comparison mode tabs**

Each tab is its own client component:

**Safety Prompts Tab:**
- Grouped bar chart (none/generic/specific per model)
- Delta table with % improvement arrows
- Auto-generated insight callout

**Thinking vs Standard Tab:**
- Paired horizontal bars per model family
- Radar overlay: standard vs thinking
- Delta table

**Frameworks Tab:**
- Stacked bar chart: Flask/Express/Fiber per model
- Expandable table per framework

**Model Families Tab:**
- Distribution visualization (box-plot style using recharts custom shapes or simplified min/median/max bars)
- Summary cards per family

**Step 2: Create compare page**

Server component fetching all comparison data. Passes to client wrapper with framer-motion animated tab transitions.

**Step 3: Commit**

```bash
git add dashboard/app/compare/ dashboard/components/compare/
git commit -m "feat: compare page with 4 interactive comparison modes"
```

---

## Phase 8: Cleanup and Polish

### Task 20: Remove old pages and routes

**Files:**
- Delete: `dashboard/app/cwes/` (replaced by /vulnerabilities)
- Delete: `dashboard/app/scenarios/` (now inline in models)
- Delete: `dashboard/app/results/` (now in slide panels)
- Delete: `dashboard/app/models/[config]/page.tsx` (replaced by new /models)
- Move old `dashboard/app/compare/page.tsx` if not already replaced

**Step 1: Remove old route directories**

```bash
rm -rf dashboard/app/cwes dashboard/app/scenarios dashboard/app/results dashboard/app/models/\[config\]
```

**Step 2: Verify build**

```bash
cd dashboard && npm run build
```

No broken imports or missing pages.

**Step 3: Commit**

```bash
git add -A dashboard/app/
git commit -m "chore: remove old page routes replaced by redesign"
```

---

### Task 21: Code viewer and log viewer in slide panel

**Files:**
- Modify: `dashboard/components/code-viewer.tsx`
- Modify: `dashboard/components/log-viewer.tsx`

**Step 1: Update code viewer for dark theme**

- Ensure syntax highlighter uses a dark theme (oneDark or similar) that matches the new design
- Add copy button with "Copied!" feedback
- Line numbers always visible
- Tab interface if multiple files

**Step 2: Update log viewer**

- Dark monospace styling matching theme
- Auto-scroll to bottom option
- Collapsible sections for long logs

**Step 3: Commit**

```bash
git add dashboard/components/code-viewer.tsx dashboard/components/log-viewer.tsx
git commit -m "feat: updated code and log viewers for dark theme"
```

---

### Task 22: Final build verification and polish

**Files:**
- Various touch-ups

**Step 1: Full build**

```bash
cd dashboard && npm run build
```

Fix any TypeScript errors or build issues.

**Step 2: Visual review**

Run dev server, visit all 4 pages, verify:
- Dark theme consistent everywhere
- Animations smooth (no jank)
- Charts render with data
- Filters work
- Slide panels open/close
- Command palette searches
- Tooltips appear
- Responsive behavior acceptable

**Step 3: Commit any fixes**

```bash
git add -A dashboard/
git commit -m "fix: final polish and build fixes for dashboard redesign"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-5 | Foundation: deps, theme, nav, transitions, cmd palette |
| 2 | 6-9 | Shared: stat cards, slide panel, tooltips, skeletons |
| 3 | 10 | Data: new query functions and types |
| 4 | 11-15 | Overview page: header, stats, ranking, heatmap, safety chart |
| 5 | 16-17 | Models page: filters, cards, detail panel, radar |
| 6 | 18 | Vulnerabilities page: treemap, CWE list, heatmap |
| 7 | 19 | Compare page: 4 comparison modes |
| 8 | 20-22 | Cleanup: remove old routes, polish, verify |
