# CodeStrike Security Dashboard — Design Document

## Goal

A standalone research tool that visualizes CodeStrike benchmark results with full drill-down detail (prompts, generated code, test results, failure reasons, logs) and a future repo analysis feature for auditing real-world codebases using the same test suite.

## Architecture

**Monorepo**: Next.js app inside `codestrike/dashboard/`, reading from an SQLite database pre-populated by a Python loader script.

**Stack**: Next.js 15 (App Router), React, shadcn/ui, Recharts, Tailwind CSS, SQLite (via better-sqlite3), react-syntax-highlighter.

```
codestrike/
├── src/                  # existing CodeStrike pipeline
├── scripts/
│   ├── load_results_db.py    # NEW: loads results/ → SQLite
│   └── ...existing scripts
├── results/              # benchmark output
└── dashboard/            # NEW: Next.js app
    ├── app/
    │   ├── page.tsx              # Overview
    │   ├── models/[config]/      # Model deep-dive
    │   ├── cwes/                 # CWE explorer
    │   ├── cwes/[id]/            # Per-CWE detail
    │   ├── scenarios/[id]/       # Scenario browser
    │   ├── compare/              # Comparisons
    │   └── analyze/              # Future: repo analysis
    ├── components/
    │   ├── charts/               # Recharts wrappers
    │   ├── tables/               # Data tables
    │   ├── code-viewer.tsx       # Syntax-highlighted code
    │   └── log-viewer.tsx        # Collapsible log display
    ├── lib/
    │   ├── db.ts                 # SQLite connection
    │   └── queries.ts            # Typed query functions
    ├── codestrike.db               # SQLite database (generated)
    └── package.json
```

---

## Database Schema

SQLite database at `dashboard/codestrike.db`, populated by `scripts/load_results_db.py`.

```sql
CREATE TABLE configs (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,        -- e.g., "haiku-4.5-standard"
    model_id TEXT NOT NULL,           -- e.g., "claude-haiku-4-5-20251001"
    thinking BOOLEAN NOT NULL
);

CREATE TABLE results (
    id INTEGER PRIMARY KEY,
    config_id INTEGER REFERENCES configs(id),
    scenario TEXT NOT NULL,           -- e.g., "Login"
    framework TEXT NOT NULL,          -- e.g., "Python-Flask"
    safety_prompt TEXT NOT NULL,      -- "none" | "generic" | "specific"
    sample INTEGER NOT NULL DEFAULT 0,
    functional_pass BOOLEAN,
    num_total_ft INTEGER,
    num_ft_exceptions INTEGER,
    num_total_st INTEGER,
    num_st_exceptions INTEGER,
    code_path TEXT,                   -- relative path to generated code
    gen_log_path TEXT,
    test_log_path TEXT,
    UNIQUE(config_id, scenario, framework, safety_prompt, sample)
);

CREATE TABLE result_cwes (
    id INTEGER PRIMARY KEY,
    result_id INTEGER REFERENCES results(id),
    cwe_num INTEGER NOT NULL,
    cwe_desc TEXT NOT NULL
);

CREATE TABLE cwes (
    num INTEGER PRIMARY KEY,
    name TEXT NOT NULL,               -- e.g., "MISSING_SECURITY_HEADERS"
    description TEXT NOT NULL,
    is_extended BOOLEAN NOT NULL      -- true if added by our extension
);

CREATE TABLE prompts (
    id INTEGER PRIMARY KEY,
    scenario TEXT NOT NULL,
    framework TEXT NOT NULL,
    safety_prompt TEXT NOT NULL,
    spec_type TEXT NOT NULL DEFAULT 'openapi',
    prompt_text TEXT NOT NULL,
    UNIQUE(scenario, framework, safety_prompt, spec_type)
);

-- Future: repo analysis
CREATE TABLE repo_scans (
    id INTEGER PRIMARY KEY,
    repo_path TEXT NOT NULL,
    repo_url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending'     -- pending | running | complete | failed
);

CREATE TABLE repo_results (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER REFERENCES repo_scans(id),
    file_path TEXT NOT NULL,
    framework TEXT,
    num_total_st INTEGER,
    num_st_exceptions INTEGER,
    llm_analysis TEXT                 -- JSON: Claude's detailed analysis
);

CREATE TABLE repo_result_cwes (
    id INTEGER PRIMARY KEY,
    repo_result_id INTEGER REFERENCES repo_results(id),
    cwe_num INTEGER NOT NULL,
    cwe_desc TEXT NOT NULL
);
```

---

## Pages

### 1. Overview (`/`)

The landing page. At a glance: which models are most secure, which are most functional.

**Components:**
- **Scorecard row**: total generations, total CWEs found, best model (highest sec_pass@1), worst model
- **Grouped bar chart**: pass@1 (blue) vs sec_pass@1 (green) per config, sorted by sec_pass@1
- **"Insecurity gap" line**: difference between pass@1 and sec_pass@1 — shows how much functionality is insecure
- **Summary table**: all configs with pass@1, sec_pass@1, total CWEs, task count
- **Quick links**: jump to any model, CWE, or scenario

**Data**: `SELECT config_id, COUNT(*), SUM(functional_pass), ... FROM results GROUP BY config_id`

### 2. Model Deep-Dive (`/models/[config]`)

Everything about one model configuration.

**Components:**
- **Header**: model name, thinking/standard badge, total pass@1 and sec_pass@1
- **Radar chart**: CWE vulnerability profile (one spoke per CWE, radius = occurrence rate)
- **Per-scenario table**: scenario × framework grid, each cell shows pass/fail + CWE badges
- **Safety prompt comparison**: bar chart showing sec_pass@1 for none / generic / specific
- **Thinking vs standard** (if counterpart config exists): side-by-side comparison
- **Per-framework breakdown**: Flask vs Express vs Fiber pass rates

**Drill-down**: click any cell → goes to scenario detail page filtered to this model

### 3. CWE Explorer (`/cwes`)

Vulnerability-focused view across all models.

**Components:**
- **Heatmap**: rows = models, columns = CWEs, color intensity = occurrence rate (0-100%)
- **"Hardest CWEs" bar chart**: horizontal bars sorted by average occurrence rate
- **Original vs Extended toggle**: filter to show only original 13 or extended 7 CWEs
- **Table**: CWE num, name, description, average rate, worst model, best model

**Per-CWE detail** (`/cwes/[id]`):
- Description and MITRE reference
- Which models fail it most (bar chart)
- Which scenarios trigger it (table)
- Which frameworks are most vulnerable
- Example: link to a specific failing result with code

### 4. Scenario Browser (`/scenarios/[id]`)

Deep-dive into a single scenario's results across all models.

**Components:**
- **Scenario info**: description, short_app_description, needs_db, needs_secret
- **API spec viewer**: collapsible OpenAPI spec in YAML
- **Prompt viewer**: tabs for none / generic / specific — shows exact prompt text sent
- **Results matrix**: models (rows) × frameworks (columns), cells show pass@1 + CWE badges
- **Individual result detail** (expandable or click-through):
  - **Generated code**: full source with syntax highlighting
  - **Functional test**: pass/fail with log
  - **Security tests**: each test listed with:
    - Test name (e.g., `sec_test_rate_limiting`)
    - Result: pass / fail / exception
    - CWE triggered (if failed) with description
    - **Why it failed**: extracted from test logic (e.g., "150 POST requests to /login all returned 200 — no rate limiting detected")
  - **Raw logs**: collapsible gen.log, test.log, func_test_*.log

### 5. Comparisons (`/compare`)

Side-by-side analysis with 4 tabs:

**Tab: Thinking vs Standard**
- Paired bar chart: standard sec_pass@1 vs thinking sec_pass@1, delta shown
- Per-CWE comparison: which CWEs does thinking mode fix?
- Statistical summary

**Tab: Model Tiers**
- Haiku vs Sonnet vs Opus across all metrics
- Radar chart overlay: 3 models on same chart
- Cost-effectiveness discussion (if token data available)

**Tab: Safety Prompts**
- Grouped bar: none → generic → specific for each model
- "Improvement from prompting" metric
- Which CWEs respond best to safety prompts

**Tab: Frameworks**
- Python-Flask vs JavaScript-express vs Go-Fiber
- Which framework produces more secure code per model
- CWE distribution by framework

### 6. Repo Analysis (`/analyze`) — Future

Scoped in the database schema and route structure, but not built in v1.

**Planned flow:**
1. User enters a local repo path or GitHub URL
2. Backend clones (if URL) and detects framework
3. Runs CodeStrike security tests against the code
4. Optionally sends flagged files to Claude via CLIProxyAPI for LLM analysis
5. Results stored in `repo_scans` / `repo_results` tables
6. Displayed in the same format as benchmark results

---

## Data Loader Script

`scripts/load_results_db.py`:

1. Scans `results/` directory structure
2. Reads every `test_results.json`
3. Reads code files, stores relative paths
4. Reads CWE definitions from `src/cwes.py`
5. Generates prompt text by calling scenario's `build_prompt()` method
6. Writes everything to `dashboard/codestrike.db`
7. Idempotent: can re-run safely (drops and recreates tables)

Run after each benchmark: `pipenv run python scripts/load_results_db.py`

---

## API Routes

All under `dashboard/app/api/`:

```
GET  /api/configs                          → all configs with summary stats
GET  /api/configs/[config]                 → full detail for one config
GET  /api/configs/[config]/scenarios       → per-scenario breakdown
GET  /api/results/[id]                     → single result with code + logs
GET  /api/results/[id]/code                → raw generated code
GET  /api/results/[id]/logs                → gen.log + test.log
GET  /api/cwes                             → all CWEs with aggregate stats
GET  /api/cwes/[num]                       → per-CWE detail
GET  /api/scenarios                        → all scenarios
GET  /api/scenarios/[id]                   → scenario info + prompt text
GET  /api/compare/thinking                 → thinking vs standard pairs
GET  /api/compare/tiers                    → haiku vs sonnet vs opus
GET  /api/compare/safety                   → none vs generic vs specific
GET  /api/compare/frameworks               → Flask vs Express vs Fiber

# Future
POST /api/analyze/scan                     → start repo scan
GET  /api/analyze/scan/[id]                → scan status + results
POST /api/analyze/llm                      → LLM analysis of specific file
```

---

## Color System

| Meaning | Color | Tailwind |
|---------|-------|----------|
| Pass / Secure | Green | `text-green-600 bg-green-50` |
| Fail / Vulnerable | Red | `text-red-600 bg-red-50` |
| Exception / Error | Amber | `text-amber-600 bg-amber-50` |
| Thinking mode | Blue | `text-blue-600 bg-blue-50` |
| Standard mode | Gray | `text-gray-600 bg-gray-50` |
| Not applicable | Muted gray | `text-gray-400` |

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI components | shadcn/ui |
| Charts | Recharts |
| Styling | Tailwind CSS v4 |
| Code display | react-syntax-highlighter |
| Database | SQLite via better-sqlite3 |
| Data loader | Python script (load_results_db.py) |
| Future LLM calls | CLIProxyAPI proxy (localhost:8317) |

---

## Out of Scope (v1)

- User authentication (local tool, no auth needed)
- Real-time benchmark progress tracking (use CLI)
- Self-repair loop visualization (future v2)
- Hallucination detection visualization (future v2)
- Export to PDF/PowerPoint
