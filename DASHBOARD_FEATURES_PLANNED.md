# Dashboard Features — Planned

**Created:** March 25, 2026
**Status:** Not yet implemented

These features are planned for a future session. Implement them after more model benchmarks are complete so the charts have richer data to display.

---

## Priority 1 — High Value (for COMP 4210 Paper)

### 1. Cost vs Security Scatter Plot

**Where:** Overview page (`/`) or Compare page (`/compare`)

**What it shows:**
- X-axis: Cost per full benchmark run ($0 for Ollama, ~$20–$80 for Claude)
- Y-axis: sec_pass@1 (%)
- Bubble size: Relative model parameter count (6.7B, 7B, 70B, 200B+)
- Color: Model family (Haiku/Sonnet/Opus/DeepSeek/etc.)

**Why it matters:**
This is the core argument of the paper — visually proves that free models achieve 42.9% vs 94% at $50–80. One chart tells the whole story.

**Implementation notes:**
- Cost data is static (hardcoded per model family, not in DB)
- Use Recharts `ScatterChart` component
- Add a tooltip showing model name, cost, sec_pass@1, and parameter count
- Hardcoded cost map:
  ```ts
  const costMap = {
    "haiku":    { cost: 20,  params: "~20B"  },
    "sonnet":   { cost: 50,  params: "~200B" },
    "opus":     { cost: 80,  params: "~200B" },
    "deepseek": { cost: 0,   params: "6.7B"  },
    "codellama":{ cost: 0,   params: "7B"    },
    "qwen":     { cost: 0,   params: "7B"    },
    "mistral":  { cost: 0,   params: "7B"    },
  }
  ```

---

### 2. Scenario Deep-Dive Page (`/scenarios`)

**Where:** New page, add to nav

**What it shows:**
- List of all 27 scenarios (Calculator, Login, Forum, FileSearch, etc.)
- Click a scenario to open a detail panel showing:
  - Pass rate per model for that scenario
  - Top CWEs triggered in that scenario
  - Framework breakdown (Flask vs Express vs Go-Fiber) for that scenario
  - Which model handles this scenario best/worst

**Why it matters:**
Currently the dashboard is model-centric. This flips the view to scenario-centric — useful for showing "Login scenarios are the most vulnerable" or "Go-Fiber is safer than Flask for FileSearch".

**Implementation notes:**
- Query pattern mirrors `/models` page but grouped by scenario instead of config
- Reuse `SlidePanel` component for detail view
- New query needed in `queries.ts`:
  ```ts
  getAllScenarios() // summary list — already exists
  getScenarioDetail(scenario: string) // per-model + per-framework breakdown — needs adding
  ```
- Reuse `ModelRankingChart` component with scenario filter applied

---

## Priority 2 — Medium Value

### 3. Generated Code Viewer

**Where:** Models page — inside the model detail panel

**What it shows:**
- The actual AI-generated code for any result (code_path column exists in DB)
- Syntax highlighted (use `shiki` or `prism`)
- Side-by-side with the CWEs it triggered
- Toggle between frameworks (Flask / Express / Go-Fiber)

**Why it matters:**
Makes the benchmark concrete — you can show exactly what vulnerable code looks like vs secure code. Great for paper figures.

**Implementation notes:**
- `code-viewer.tsx` component already exists but is not wired up
- `code_path` column in `results` table points to file on disk
- Add a file-read API route: `app/api/code/route.ts`
- Only show this on localhost (file paths won't exist on other machines)

---

### 4. Export / Report

**Where:** Any page — add an Export button in the nav or per-page

**What it shows:**
- **CSV export**: All results (model, scenario, framework, safety_prompt, sec_pass, cwes)
- **Table copy**: Formatted markdown table for pasting into paper
- Stretch: PDF summary with key charts

**Why it matters:**
Saves manual work when writing the paper — one click to get LaTeX-ready tables.

**Implementation notes:**
- CSV: client-side using `papaparse` or just `JSON.stringify` + blob download
- Add an API route `app/api/export/route.ts` that streams the DB query as CSV
- Markdown table: format via template string, copy to clipboard

---

### 5. CWE Trend Lines per Model

**Where:** Compare page — Safety Prompts tab

**What it shows:**
- Line chart (not bar chart) showing sec_pass@1 progression: `none → generic → specific`
- One line per model, making the slope (improvement) visually obvious
- Delta annotation on each line showing absolute improvement

**Why it matters:**
Current safety comparison chart shows bars — hard to see which models respond most to safety prompting. Line chart makes the trend clearer.

**Implementation notes:**
- Data already available via `getSafetyPromptComparison()` query
- Replace or add alongside existing `SafetyComparisonChart`
- Use Recharts `LineChart` with dots at each safety level

---

### 6. Framework Security Ranking (Overview)

**Where:** Overview page — below the model ranking chart

**What it shows:**
- Simple ranked table: which framework produces the most secure code on average
- Average sec_pass@1 across all models and scenarios per framework
- Highlight the safest and least safe framework

**Why it matters:**
Currently buried in the Compare page. A one-liner on Overview would make it prominent and quotable in the paper.

**Implementation notes:**
- Query already exists: `getFrameworkComparison()`
- Aggregate into a 3-row summary table (Flask, Express, Go-Fiber)
- Reuse `StatCard` or a simple table component

---

## Priority 3 — Nice to Have

### 7. Shareable / Bookmark URLs

Encode active filters and selected model into the URL query string so a specific view can be linked or bookmarked. Useful for sharing a specific model's breakdown.

### 8. Dark / Light Mode Toggle

Currently hardcoded dark theme. Add a toggle in the nav. Low priority — cosmetic only.

### 9. Benchmark Run Timeline

If new benchmarks are loaded into the DB over time, show a timeline of when each model's results were added. Useful for tracking progress across multiple laptop runs.

---

## Implementation Order (when ready)

1. Cost vs Security scatter plot — fastest to implement, highest paper impact
2. Scenario deep-dive page — reuses existing patterns, adds new insight angle
3. CWE trend lines — small change to existing compare page
4. Framework ranking on overview — one query + one table component
5. Generated code viewer — requires API route for file reading
6. Export / CSV — straightforward, useful for paper writing

---

## Files to Touch (quick reference)

| Feature | Files |
|---------|-------|
| Cost scatter plot | `dashboard/app/page.tsx`, new `components/charts/cost-security-chart.tsx` |
| Scenario page | new `dashboard/app/scenarios/page.tsx`, new `components/scenario-detail.tsx`, `dashboard/lib/queries.ts` |
| Code viewer | `dashboard/app/api/code/route.ts`, `components/code-viewer.tsx` (already exists) |
| Export | new `dashboard/app/api/export/route.ts`, add button to nav |
| CWE trend lines | `dashboard/components/compare/safety-prompt-tab.tsx` |
| Framework ranking | `dashboard/app/page.tsx`, reuse existing query |
