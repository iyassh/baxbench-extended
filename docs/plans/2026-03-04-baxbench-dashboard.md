# CodeStrike Security Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local Next.js dashboard that visualizes CodeStrike benchmark results with full drill-down detail (prompts, generated code, test results, failure reasons, logs) and scoped future repo analysis.

**Architecture:** Python loader script reads the `results/` directory tree and populates an SQLite database at `dashboard/codestrike.db`. Next.js 15 App Router serves the dashboard using `better-sqlite3` for server-side queries. All data access happens in Server Components — no client-side DB calls.

**Tech Stack:** Next.js 15 (App Router), React 19, shadcn/ui, Recharts, Tailwind CSS v4, SQLite via better-sqlite3, react-syntax-highlighter, Python 3.12 (loader script)

**Design Doc:** `docs/plans/2026-03-04-codestrike-dashboard-design.md`

---

## Task 1: Scaffold the Next.js Dashboard App

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/next.config.ts`
- Create: `dashboard/tailwind.config.ts`
- Create: `dashboard/app/layout.tsx`
- Create: `dashboard/app/page.tsx`
- Create: `dashboard/app/globals.css`
- Create: `dashboard/.gitignore`

**Step 1: Create the Next.js app**

```bash
cd /Users/yassh/codestrike
npx create-next-app@latest dashboard --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --no-turbopack
```

Accept defaults. This scaffolds the full app structure.

**Step 2: Install dashboard-specific dependencies**

```bash
cd /Users/yassh/codestrike/dashboard
npm install better-sqlite3 recharts react-syntax-highlighter
npm install -D @types/better-sqlite3 @types/react-syntax-highlighter
```

**Step 3: Install shadcn/ui**

```bash
cd /Users/yassh/codestrike/dashboard
npx shadcn@latest init --defaults
```

Accept defaults (New York style, Zinc color, CSS variables).

**Step 4: Add commonly needed shadcn components**

```bash
cd /Users/yassh/codestrike/dashboard
npx shadcn@latest add card badge table tabs select separator tooltip
```

**Step 5: Verify the app starts**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Expected: App runs on `localhost:3000` with the default Next.js page.

**Step 6: Update `.gitignore` for dashboard**

Add to `dashboard/.gitignore`:
```
codestrike.db
```

The SQLite database is generated and should not be committed.

**Step 7: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/
git commit -m "feat(dashboard): scaffold Next.js 15 app with shadcn/ui, recharts, better-sqlite3"
```

---

## Task 2: Write the Python Data Loader Script

This script reads `results/` and populates `dashboard/codestrike.db`. It is the sole data pipeline between CodeStrike results and the dashboard.

**Files:**
- Create: `scripts/load_results_db.py`

**Reference:**
- `scripts/rate_limit_queue.py` — contains `MODEL_CONFIGS` with name → model_id → thinking mappings
- `src/cwes.py` — CWE enum definitions
- `src/scenarios/base.py` — `build_prompt()` method
- Results path format: `results/{config_name}/{model_id}/{scenario}/{framework}/temp{temp}-openapi-{safety_prompt}/sample{n}/`
- `test_results.json` format: `{"num_passed_ft": int, "num_total_ft": int, "num_ft_exceptions": int, "num_total_st": int, "num_st_exceptions": int, "cwes": [{"num": int, "desc": str}]}`

**Step 1: Create the loader script**

Create `scripts/load_results_db.py`:

```python
#!/usr/bin/env python3
"""Load CodeStrike results/ directory into dashboard/codestrike.db (SQLite).

Idempotent: drops and recreates all tables on each run.

Usage:
    pipenv run python scripts/load_results_db.py
    pipenv run python scripts/load_results_db.py --results-dir results --db dashboard/codestrike.db
"""
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

# Add src/ to path so we can import CodeStrike modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from cwes import CWE

# Model configs — must match rate_limit_queue.py
MODEL_CONFIGS = [
    {"name": "opus-4-standard", "model": "claude-opus-4-20250514", "thinking": False},
    {"name": "opus-4-thinking", "model": "claude-opus-4-20250514", "thinking": True},
    {"name": "opus-4.5-standard", "model": "claude-opus-4-5-20251101", "thinking": False},
    {"name": "opus-4.5-thinking", "model": "claude-opus-4-5-20251101", "thinking": True},
    {"name": "sonnet-4-standard", "model": "claude-sonnet-4-20250514", "thinking": False},
    {"name": "sonnet-4-thinking", "model": "claude-sonnet-4-20250514", "thinking": True},
    {"name": "sonnet-4.5-standard", "model": "claude-sonnet-4-5-20250929", "thinking": False},
    {"name": "sonnet-4.5-thinking", "model": "claude-sonnet-4-5-20250929", "thinking": True},
    {"name": "haiku-4.5-standard", "model": "claude-haiku-4-5-20251001", "thinking": False},
    {"name": "haiku-4.5-thinking", "model": "claude-haiku-4-5-20251001", "thinking": True},
]

CONFIG_BY_NAME = {c["name"]: c for c in MODEL_CONFIGS}

SCHEMA = """
CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    model_id TEXT NOT NULL,
    thinking BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS cwes (
    num INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    is_extended BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY,
    config_id INTEGER REFERENCES configs(id),
    scenario TEXT NOT NULL,
    framework TEXT NOT NULL,
    safety_prompt TEXT NOT NULL,
    sample INTEGER NOT NULL DEFAULT 0,
    functional_pass BOOLEAN,
    num_passed_ft INTEGER,
    num_total_ft INTEGER,
    num_ft_exceptions INTEGER,
    num_total_st INTEGER,
    num_st_exceptions INTEGER,
    code_path TEXT,
    gen_log_path TEXT,
    test_log_path TEXT,
    UNIQUE(config_id, scenario, framework, safety_prompt, sample)
);

CREATE TABLE IF NOT EXISTS result_cwes (
    id INTEGER PRIMARY KEY,
    result_id INTEGER REFERENCES results(id),
    cwe_num INTEGER NOT NULL,
    cwe_desc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY,
    scenario TEXT NOT NULL,
    framework TEXT NOT NULL,
    safety_prompt TEXT NOT NULL,
    spec_type TEXT NOT NULL DEFAULT 'openapi',
    prompt_text TEXT NOT NULL,
    UNIQUE(scenario, framework, safety_prompt, spec_type)
);

-- Future: repo analysis
CREATE TABLE IF NOT EXISTS repo_scans (
    id INTEGER PRIMARY KEY,
    repo_path TEXT NOT NULL,
    repo_url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS repo_results (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER REFERENCES repo_scans(id),
    file_path TEXT NOT NULL,
    framework TEXT,
    num_total_st INTEGER,
    num_st_exceptions INTEGER,
    llm_analysis TEXT
);

CREATE TABLE IF NOT EXISTS repo_result_cwes (
    id INTEGER PRIMARY KEY,
    repo_result_id INTEGER REFERENCES repo_results(id),
    cwe_num INTEGER NOT NULL,
    cwe_desc TEXT NOT NULL
);
"""

# Original CodeStrike CWEs (before our extension)
ORIGINAL_CWE_NAMES = {
    "XSS", "PATH_TRAVERSAL", "CODE_INJECTION", "SQL_INJECTION",
    "IMPROPER_ACCESS_CONTROL", "IMPROPER_AUTHENTICATION",
    "IMPROPER_OUTPUT_NEUTRALIZATION_FOR_LOGS", "OS_INJECTION",
    "UNCONTROLLED_RESOURCE_CONSUMPTION", "UNRESTRICTED_UPLOAD_WITH_DANGEROUS_FILE",
    "INSUFFICIENTLY_PROTECTED_CREDENTIALS", "INCORRECT_AUTHORIZATION",
    "IMPROPER_CHECK_OR_HANDLING_OF_EXCEPTIONAL_CONDITIONS", "IMPROPER_INPUT_VALIDATION",
}


def init_db(db_path: str) -> sqlite3.Connection:
    """Create database and tables. Drops existing tables for idempotency."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    # Drop all tables for clean reload
    for table in ["repo_result_cwes", "repo_results", "repo_scans",
                   "result_cwes", "results", "prompts", "cwes", "configs"]:
        conn.execute(f"DROP TABLE IF EXISTS {table}")

    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def load_cwes(conn: sqlite3.Connection):
    """Load all CWE definitions from src/cwes.py."""
    for cwe in CWE:
        is_extended = cwe.name not in ORIGINAL_CWE_NAMES
        conn.execute(
            "INSERT OR REPLACE INTO cwes (num, name, description, is_extended) VALUES (?, ?, ?, ?)",
            (cwe.value["num"], cwe.name, cwe.value["desc"], is_extended),
        )
    conn.commit()


def load_configs(conn: sqlite3.Connection) -> dict[str, int]:
    """Insert all model configs. Returns name → config_id mapping."""
    name_to_id = {}
    for cfg in MODEL_CONFIGS:
        cur = conn.execute(
            "INSERT INTO configs (name, model_id, thinking) VALUES (?, ?, ?)",
            (cfg["name"], cfg["model"], cfg["thinking"]),
        )
        name_to_id[cfg["name"]] = cur.lastrowid
    conn.commit()
    return name_to_id


def load_prompts(conn: sqlite3.Connection):
    """Generate and store prompt text for each scenario × framework × safety_prompt combo.

    This imports CodeStrike scenario modules and calls build_prompt().
    """
    try:
        from scenarios import SCENARIOS as SCENARIO_OBJECTS
        from env.base import Env
        from env import ENVS
    except ImportError:
        print("  WARN: Could not import CodeStrike scenarios. Skipping prompt loading.")
        print("  (Run from the codestrike root directory with: pipenv run python scripts/load_results_db.py)")
        return

    env_map = {e.id: e for e in ENVS}
    frameworks = ["Python-Flask", "JavaScript-express", "Go-Fiber"]
    safety_prompts = ["none", "generic", "specific"]

    for scenario in SCENARIO_OBJECTS:
        for fw in frameworks:
            env = env_map.get(fw)
            if env is None:
                continue
            for safety in safety_prompts:
                try:
                    prompt_text = scenario.build_prompt(env, "openapi", safety, agent=False)
                    conn.execute(
                        "INSERT OR REPLACE INTO prompts (scenario, framework, safety_prompt, spec_type, prompt_text) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (scenario.id, fw, safety, "openapi", prompt_text),
                    )
                except Exception as e:
                    print(f"  WARN: Could not build prompt for {scenario.id}/{fw}/{safety}: {e}")

    conn.commit()


def load_results(conn: sqlite3.Connection, results_dir: str, config_ids: dict[str, int]):
    """Walk results/ directory tree and load all test results."""
    results_path = Path(results_dir)
    loaded = 0
    skipped = 0

    for config_dir in sorted(results_path.iterdir()):
        if not config_dir.is_dir():
            continue
        config_name = config_dir.name
        if config_name.startswith("."):
            continue
        config_id = config_ids.get(config_name)
        if config_id is None:
            print(f"  WARN: Unknown config dir '{config_name}', skipping")
            continue

        cfg = CONFIG_BY_NAME[config_name]
        model_dir = config_dir / cfg["model"]
        if not model_dir.exists():
            print(f"  WARN: No model dir for {config_name}/{cfg['model']}")
            continue

        for scenario_dir in sorted(model_dir.iterdir()):
            if not scenario_dir.is_dir():
                continue
            scenario = scenario_dir.name

            for fw_dir in sorted(scenario_dir.iterdir()):
                if not fw_dir.is_dir():
                    continue
                framework = fw_dir.name

                for param_dir in sorted(fw_dir.iterdir()):
                    if not param_dir.is_dir():
                        continue
                    # Parse: temp0.2-openapi-none
                    parts = param_dir.name.split("-")
                    # safety_prompt is the last part
                    safety_prompt = parts[-1] if len(parts) >= 3 else "none"

                    for sample_dir in sorted(param_dir.iterdir()):
                        if not sample_dir.is_dir() or not sample_dir.name.startswith("sample"):
                            continue
                        sample_num = int(sample_dir.name.replace("sample", ""))

                        tr_file = sample_dir / "test_results.json"
                        if not tr_file.exists():
                            skipped += 1
                            continue

                        with open(tr_file) as f:
                            tr = json.load(f)

                        # Determine paths relative to repo root
                        code_dir = sample_dir / "code"
                        code_path = None
                        if code_dir.exists():
                            code_files = list(code_dir.iterdir())
                            if code_files:
                                code_path = str(code_files[0].relative_to(results_path.parent))

                        test_log = sample_dir / "test.log"
                        test_log_path = str(test_log.relative_to(results_path.parent)) if test_log.exists() else None

                        functional_pass = tr.get("num_passed_ft", 0) == tr.get("num_total_ft", 0) and tr.get("num_total_ft", 0) > 0

                        cur = conn.execute(
                            """INSERT OR REPLACE INTO results
                            (config_id, scenario, framework, safety_prompt, sample,
                             functional_pass, num_passed_ft, num_total_ft, num_ft_exceptions,
                             num_total_st, num_st_exceptions, code_path, test_log_path)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (config_id, scenario, framework, safety_prompt, sample_num,
                             functional_pass,
                             tr.get("num_passed_ft"), tr.get("num_total_ft"), tr.get("num_ft_exceptions"),
                             tr.get("num_total_st"), tr.get("num_st_exceptions"),
                             code_path, test_log_path),
                        )
                        result_id = cur.lastrowid

                        # Insert CWEs found in this result
                        for cwe_entry in tr.get("cwes", []):
                            conn.execute(
                                "INSERT INTO result_cwes (result_id, cwe_num, cwe_desc) VALUES (?, ?, ?)",
                                (result_id, cwe_entry["num"], cwe_entry["desc"]),
                            )

                        loaded += 1

    conn.commit()
    print(f"  Loaded {loaded} results, skipped {skipped} (no test_results.json)")


def main():
    parser = argparse.ArgumentParser(description="Load CodeStrike results into SQLite for the dashboard")
    parser.add_argument("--results-dir", default="results", help="Path to results/ directory")
    parser.add_argument("--db", default="dashboard/codestrike.db", help="Output SQLite database path")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.db), exist_ok=True)

    print(f"Loading results from: {args.results_dir}")
    print(f"Writing database to: {args.db}")

    conn = init_db(args.db)

    print("Loading CWE definitions...")
    load_cwes(conn)

    print("Loading model configs...")
    config_ids = load_configs(conn)

    print("Loading prompts...")
    load_prompts(conn)

    print("Loading results...")
    load_results(conn, args.results_dir, config_ids)

    # Print summary
    row = conn.execute("SELECT COUNT(*) FROM results").fetchone()
    print(f"\nDatabase ready: {row[0]} results loaded")
    row = conn.execute("SELECT COUNT(DISTINCT config_id) FROM results").fetchone()
    print(f"  Configs with results: {row[0]}")
    row = conn.execute("SELECT COUNT(*) FROM result_cwes").fetchone()
    print(f"  CWE occurrences: {row[0]}")
    row = conn.execute("SELECT COUNT(*) FROM prompts").fetchone()
    print(f"  Prompts stored: {row[0]}")

    conn.close()
    print("\nDone! Run the dashboard with: cd dashboard && npm run dev")


if __name__ == "__main__":
    main()
```

**Step 2: Run the loader**

```bash
cd /Users/yassh/codestrike
pipenv run python scripts/load_results_db.py
```

Expected: Output showing loaded results count, CWE definitions, configs. Database created at `dashboard/codestrike.db`.

**Step 3: Verify the database**

```bash
cd /Users/yassh/codestrike
sqlite3 dashboard/codestrike.db "SELECT name, model_id, thinking FROM configs;"
sqlite3 dashboard/codestrike.db "SELECT COUNT(*) FROM results;"
sqlite3 dashboard/codestrike.db "SELECT scenario, framework, safety_prompt, functional_pass FROM results LIMIT 5;"
sqlite3 dashboard/codestrike.db "SELECT num, name, is_extended FROM cwes ORDER BY num;"
```

Expected: Configs listed, results count > 0, sample rows visible, all 20+ CWEs loaded.

**Step 4: Commit**

```bash
cd /Users/yassh/codestrike
git add scripts/load_results_db.py
git commit -m "feat(dashboard): add Python data loader script for SQLite database"
```

---

## Task 3: Database Connection and Typed Query Layer

Server-side only. These functions are used by Next.js Server Components and Route Handlers.

**Files:**
- Create: `dashboard/lib/db.ts`
- Create: `dashboard/lib/queries.ts`
- Create: `dashboard/lib/types.ts`

**Step 1: Create TypeScript types**

Create `dashboard/lib/types.ts`:

```typescript
export interface Config {
  id: number;
  name: string;
  model_id: string;
  thinking: boolean;
}

export interface ConfigWithStats extends Config {
  total_results: number;
  functional_passes: number;
  secure_passes: number;
  total_cwes: number;
  pass_at_1: number;       // functional_passes / total_results
  sec_pass_at_1: number;   // secure_passes / total_results
}

export interface Result {
  id: number;
  config_id: number;
  scenario: string;
  framework: string;
  safety_prompt: string;
  sample: number;
  functional_pass: boolean;
  num_passed_ft: number;
  num_total_ft: number;
  num_ft_exceptions: number;
  num_total_st: number;
  num_st_exceptions: number;
  code_path: string | null;
  gen_log_path: string | null;
  test_log_path: string | null;
}

export interface ResultWithCwes extends Result {
  cwes: CweOccurrence[];
  config_name?: string;
}

export interface CweOccurrence {
  cwe_num: number;
  cwe_desc: string;
}

export interface CweDefinition {
  num: number;
  name: string;
  description: string;
  is_extended: boolean;
}

export interface CweWithStats extends CweDefinition {
  occurrence_count: number;
  occurrence_rate: number;
  worst_config: string;
  best_config: string;
}

export interface Prompt {
  id: number;
  scenario: string;
  framework: string;
  safety_prompt: string;
  spec_type: string;
  prompt_text: string;
}

export interface ScenarioSummary {
  scenario: string;
  total_results: number;
  functional_passes: number;
  secure_passes: number;
  unique_cwes: number;
}

export interface ComparisonPair {
  label: string;
  standard_sec_pass: number;
  thinking_sec_pass: number;
  delta: number;
}
```

**Step 2: Create database connection singleton**

Create `dashboard/lib/db.ts`:

```typescript
import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), "codestrike.db");
    db = new Database(dbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
  }
  return db;
}
```

**Step 3: Create typed query functions**

Create `dashboard/lib/queries.ts`:

```typescript
import { getDb } from "./db";
import type {
  Config,
  ConfigWithStats,
  Result,
  ResultWithCwes,
  CweDefinition,
  CweWithStats,
  CweOccurrence,
  Prompt,
  ScenarioSummary,
} from "./types";

// ── Configs ──────────────────────────────────────────────

export function getAllConfigs(): ConfigWithStats[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        c.id, c.name, c.model_id, c.thinking,
        COUNT(r.id) as total_results,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes,
        (SELECT COUNT(*) FROM result_cwes rc
         JOIN results r2 ON rc.result_id = r2.id
         WHERE r2.config_id = c.id) as total_cwes
      FROM configs c
      LEFT JOIN results r ON r.config_id = c.id
      GROUP BY c.id
      ORDER BY c.name`
    )
    .all() as (Config & { total_results: number; functional_passes: number; secure_passes: number; total_cwes: number })[];

  return rows.map((row) => ({
    ...row,
    thinking: Boolean(row.thinking),
    pass_at_1: row.total_results > 0 ? row.functional_passes / row.total_results : 0,
    sec_pass_at_1: row.total_results > 0 ? row.secure_passes / row.total_results : 0,
  }));
}

export function getConfigByName(name: string): ConfigWithStats | null {
  const all = getAllConfigs();
  return all.find((c) => c.name === name) ?? null;
}

// ── Results ──────────────────────────────────────────────

export function getResultsForConfig(configId: number): ResultWithCwes[] {
  const db = getDb();
  const results = db
    .prepare("SELECT * FROM results WHERE config_id = ? ORDER BY scenario, framework, safety_prompt")
    .all(configId) as Result[];

  return results.map((r) => ({
    ...r,
    functional_pass: Boolean(r.functional_pass),
    cwes: db
      .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
      .all(r.id) as CweOccurrence[],
  }));
}

export function getResultById(id: number): ResultWithCwes | null {
  const db = getDb();
  const result = db.prepare(
    `SELECT r.*, c.name as config_name
     FROM results r JOIN configs c ON r.config_id = c.id
     WHERE r.id = ?`
  ).get(id) as (Result & { config_name: string }) | undefined;
  if (!result) return null;

  const cwes = db
    .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
    .all(id) as CweOccurrence[];

  return { ...result, functional_pass: Boolean(result.functional_pass), cwes };
}

// ── CWEs ─────────────────────────────────────────────────

export function getAllCwes(): CweDefinition[] {
  const db = getDb();
  return db.prepare("SELECT * FROM cwes ORDER BY num").all() as CweDefinition[];
}

export function getCwesWithStats(): CweWithStats[] {
  const db = getDb();
  const cwes = getAllCwes();
  const configs = getAllConfigs();

  return cwes.map((cwe) => {
    const occurrences = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM result_cwes WHERE cwe_num = ?`
      )
      .get(cwe.num) as { cnt: number };

    const totalResults = db
      .prepare("SELECT COUNT(*) as cnt FROM results")
      .get() as { cnt: number };

    // Per-config occurrence rates
    const configRates = configs
      .filter((c) => c.total_results > 0)
      .map((c) => {
        const count = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM result_cwes rc
             JOIN results r ON rc.result_id = r.id
             WHERE rc.cwe_num = ? AND r.config_id = ?`
          )
          .get(cwe.num, c.id) as { cnt: number };
        return { name: c.name, rate: count.cnt / c.total_results };
      });

    const sorted = configRates.sort((a, b) => a.rate - b.rate);

    return {
      ...cwe,
      is_extended: Boolean(cwe.is_extended),
      occurrence_count: occurrences.cnt,
      occurrence_rate: totalResults.cnt > 0 ? occurrences.cnt / totalResults.cnt : 0,
      worst_config: sorted.length > 0 ? sorted[sorted.length - 1].name : "N/A",
      best_config: sorted.length > 0 ? sorted[0].name : "N/A",
    };
  });
}

export function getCweDetail(num: number) {
  const db = getDb();
  const cwe = db.prepare("SELECT * FROM cwes WHERE num = ?").get(num) as CweDefinition | undefined;
  if (!cwe) return null;

  // Which configs fail it most
  const byConfig = db
    .prepare(
      `SELECT c.name, COUNT(*) as cnt,
              CAST(COUNT(*) AS REAL) / COUNT(DISTINCT r.id) as rate
       FROM result_cwes rc
       JOIN results r ON rc.result_id = r.id
       JOIN configs c ON r.config_id = c.id
       WHERE rc.cwe_num = ?
       GROUP BY c.id
       ORDER BY cnt DESC`
    )
    .all(num) as { name: string; cnt: number; rate: number }[];

  // Which scenarios trigger it
  const byScenario = db
    .prepare(
      `SELECT r.scenario, COUNT(*) as cnt
       FROM result_cwes rc
       JOIN results r ON rc.result_id = r.id
       WHERE rc.cwe_num = ?
       GROUP BY r.scenario
       ORDER BY cnt DESC`
    )
    .all(num) as { scenario: string; cnt: number }[];

  // Which frameworks
  const byFramework = db
    .prepare(
      `SELECT r.framework, COUNT(*) as cnt
       FROM result_cwes rc
       JOIN results r ON rc.result_id = r.id
       WHERE rc.cwe_num = ?
       GROUP BY r.framework
       ORDER BY cnt DESC`
    )
    .all(num) as { framework: string; cnt: number }[];

  return { cwe: { ...cwe, is_extended: Boolean(cwe.is_extended) }, byConfig, byScenario, byFramework };
}

// ── Scenarios ────────────────────────────────────────────

export function getAllScenarios(): ScenarioSummary[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        r.scenario,
        COUNT(*) as total_results,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes,
        COUNT(DISTINCT rc.cwe_num) as unique_cwes
      FROM results r
      LEFT JOIN result_cwes rc ON rc.result_id = r.id
      GROUP BY r.scenario
      ORDER BY r.scenario`
    )
    .all() as ScenarioSummary[];
}

export function getScenarioResults(scenario: string): ResultWithCwes[] {
  const db = getDb();
  const results = db
    .prepare(
      `SELECT r.*, c.name as config_name
       FROM results r
       JOIN configs c ON r.config_id = c.id
       WHERE r.scenario = ?
       ORDER BY c.name, r.framework, r.safety_prompt`
    )
    .all(scenario) as (Result & { config_name: string })[];

  return results.map((r) => ({
    ...r,
    functional_pass: Boolean(r.functional_pass),
    cwes: db
      .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
      .all(r.id) as CweOccurrence[],
  }));
}

// ── Prompts ──────────────────────────────────────────────

export function getPromptsForScenario(scenario: string): Prompt[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM prompts WHERE scenario = ? ORDER BY framework, safety_prompt")
    .all(scenario) as Prompt[];
}

// ── Comparisons ──────────────────────────────────────────

export function getThinkingComparison() {
  const configs = getAllConfigs();
  const pairs: { standard: ConfigWithStats; thinking: ConfigWithStats }[] = [];

  // Match standard/thinking pairs by model base name
  const standardConfigs = configs.filter((c) => !c.thinking && c.total_results > 0);
  for (const std of standardConfigs) {
    const baseName = std.name.replace("-standard", "");
    const thk = configs.find((c) => c.name === `${baseName}-thinking` && c.total_results > 0);
    if (thk) {
      pairs.push({ standard: std, thinking: thk });
    }
  }

  return pairs;
}

export function getSafetyPromptComparison() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        c.name as config_name,
        r.safety_prompt,
        COUNT(*) as total,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c ON r.config_id = c.id
      GROUP BY c.name, r.safety_prompt
      ORDER BY c.name, r.safety_prompt`
    )
    .all() as { config_name: string; safety_prompt: string; total: number; functional_passes: number; secure_passes: number }[];
}

export function getFrameworkComparison() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        r.framework,
        c.name as config_name,
        COUNT(*) as total,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c ON r.config_id = c.id
      GROUP BY r.framework, c.name
      ORDER BY r.framework, c.name`
    )
    .all() as { framework: string; config_name: string; total: number; functional_passes: number; secure_passes: number }[];
}
```

**Step 4: Verify TypeScript compiles**

```bash
cd /Users/yassh/codestrike/dashboard
npx tsc --noEmit lib/types.ts lib/db.ts lib/queries.ts 2>&1 || echo "Check errors above"
```

Note: This may fail if Next.js isn't fully configured yet. That's OK — we'll catch issues when the app runs.

**Step 5: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/lib/
git commit -m "feat(dashboard): add database connection layer and typed query functions"
```

---

## Task 4: Layout, Navigation, and Shared Components

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Create: `dashboard/components/nav.tsx`
- Create: `dashboard/components/code-viewer.tsx`
- Create: `dashboard/components/log-viewer.tsx`
- Create: `dashboard/components/cwe-badge.tsx`
- Create: `dashboard/components/stat-card.tsx`
- Modify: `dashboard/app/globals.css` (if needed)

**Step 1: Create the navigation component**

Create `dashboard/components/nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview" },
  { href: "/cwes", label: "CWE Explorer" },
  { href: "/compare", label: "Comparisons" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 items-center gap-6 px-4">
        <Link href="/" className="font-bold text-lg">
          CodeStrike Dashboard
        </Link>
        <nav className="flex gap-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm transition-colors hover:text-foreground",
                pathname === link.href
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
```

**Step 2: Update root layout**

Replace the content of `dashboard/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CodeStrike Security Dashboard",
  description: "Visualize CodeStrike benchmark results with full drill-down detail",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Nav />
        <main className="container mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
```

**Step 3: Create shared UI components**

Create `dashboard/components/stat-card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  className?: string;
}

export function StatCard({ title, value, subtitle, className }: StatCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

Create `dashboard/components/cwe-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

interface CweBadgeProps {
  num: number;
  desc?: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
}

export function CweBadge({ num, desc, variant = "destructive" }: CweBadgeProps) {
  return (
    <Badge variant={variant} className="text-xs" title={desc}>
      CWE-{num}
    </Badge>
  );
}
```

Create `dashboard/components/code-viewer.tsx`:

```tsx
"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeViewerProps {
  code: string;
  language?: string;
  filename?: string;
}

function detectLanguage(filename: string): string {
  if (filename.endsWith(".py")) return "python";
  if (filename.endsWith(".js") || filename.endsWith(".ts")) return "javascript";
  if (filename.endsWith(".go")) return "go";
  return "text";
}

export function CodeViewer({ code, language, filename }: CodeViewerProps) {
  const lang = language ?? (filename ? detectLanguage(filename) : "text");

  return (
    <div className="rounded-md overflow-hidden">
      {filename && (
        <div className="bg-zinc-800 text-zinc-300 text-xs px-4 py-2 font-mono">
          {filename}
        </div>
      )}
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        showLineNumbers
        customStyle={{ margin: 0, fontSize: "0.8rem" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
```

Create `dashboard/components/log-viewer.tsx`:

```tsx
"use client";

import { useState } from "react";

interface LogViewerProps {
  title: string;
  content: string;
  defaultOpen?: boolean;
}

export function LogViewer({ title, content, defaultOpen = false }: LogViewerProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-md">
      <button
        className="w-full text-left px-4 py-2 text-sm font-medium hover:bg-muted/50 flex items-center justify-between"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <pre className="px-4 py-3 text-xs font-mono bg-zinc-950 text-zinc-300 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}
```

**Step 4: Verify the app compiles and renders**

```bash
cd /Users/yassh/codestrike/dashboard
npm run build 2>&1 | tail -20
```

Expected: Build succeeds (possibly with warnings about unused pages, which is fine).

**Step 5: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/components/ dashboard/app/layout.tsx
git commit -m "feat(dashboard): add navigation, layout, and shared UI components"
```

---

## Task 5: Overview Page

The landing page showing all model comparisons at a glance.

**Files:**
- Modify: `dashboard/app/page.tsx`
- Create: `dashboard/components/charts/pass-rate-chart.tsx`

**Step 1: Create the pass-rate bar chart component**

Create `dashboard/components/charts/pass-rate-chart.tsx`:

```tsx
"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface PassRateChartProps {
  data: {
    name: string;
    pass_at_1: number;
    sec_pass_at_1: number;
  }[];
}

export function PassRateChart({ data }: PassRateChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    pass_at_1: Math.round(d.pass_at_1 * 1000) / 10,
    sec_pass_at_1: Math.round(d.sec_pass_at_1 * 1000) / 10,
    gap: Math.round((d.pass_at_1 - d.sec_pass_at_1) * 1000) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={formatted} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" angle={-35} textAnchor="end" fontSize={11} height={80} />
        <YAxis domain={[0, 100]} label={{ value: "%", position: "insideLeft" }} />
        <Tooltip formatter={(value: number) => `${value}%`} />
        <Legend />
        <Bar dataKey="pass_at_1" name="pass@1 (functional)" fill="#3b82f6" />
        <Bar dataKey="sec_pass_at_1" name="sec_pass@1 (secure)" fill="#22c55e" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

**Step 2: Build the overview page**

Replace `dashboard/app/page.tsx`:

```tsx
import Link from "next/link";
import { getAllConfigs, getAllScenarios } from "@/lib/queries";
import { StatCard } from "@/components/stat-card";
import { PassRateChart } from "@/components/charts/pass-rate-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function OverviewPage() {
  const configs = getAllConfigs();
  const scenarios = getAllScenarios();

  const configsWithResults = configs.filter((c) => c.total_results > 0);
  const totalResults = configsWithResults.reduce((s, c) => s + c.total_results, 0);
  const totalCwes = configsWithResults.reduce((s, c) => s + c.total_cwes, 0);

  const bestModel = configsWithResults.length > 0
    ? [...configsWithResults].sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1)[0]
    : null;
  const worstModel = configsWithResults.length > 0
    ? [...configsWithResults].sort((a, b) => a.sec_pass_at_1 - b.sec_pass_at_1)[0]
    : null;

  const chartData = configsWithResults
    .sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1)
    .map((c) => ({
      name: c.name,
      pass_at_1: c.pass_at_1,
      sec_pass_at_1: c.sec_pass_at_1,
    }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">CodeStrike Security Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Security benchmark results across {configsWithResults.length} model configurations
          and {scenarios.length} scenarios
        </p>
      </div>

      {/* Scorecard Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Generations" value={totalResults} />
        <StatCard title="CWEs Found" value={totalCwes} />
        <StatCard
          title="Most Secure"
          value={bestModel?.name ?? "N/A"}
          subtitle={bestModel ? `sec_pass@1: ${(bestModel.sec_pass_at_1 * 100).toFixed(1)}%` : undefined}
        />
        <StatCard
          title="Least Secure"
          value={worstModel?.name ?? "N/A"}
          subtitle={worstModel ? `sec_pass@1: ${(worstModel.sec_pass_at_1 * 100).toFixed(1)}%` : undefined}
        />
      </div>

      {/* Bar Chart */}
      {chartData.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">pass@1 vs sec_pass@1 by Model</h2>
          <PassRateChart data={chartData} />
        </div>
      )}

      {/* Config Summary Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Model Configurations</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Config</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Results</TableHead>
              <TableHead className="text-right">pass@1</TableHead>
              <TableHead className="text-right">sec_pass@1</TableHead>
              <TableHead className="text-right">CWEs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configsWithResults.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/models/${c.name}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={c.thinking ? "default" : "secondary"}>
                    {c.thinking ? "thinking" : "standard"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{c.total_results}</TableCell>
                <TableCell className="text-right">
                  {(c.pass_at_1 * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  {(c.sec_pass_at_1 * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">{c.total_cwes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Scenario Quick Links */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Scenarios</h2>
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s) => (
            <Link key={s.scenario} href={`/scenarios/${s.scenario}`}>
              <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                {s.scenario}
              </Badge>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Verify the page renders**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Open `http://localhost:3000` — should show the overview with scorecard, chart, table, and scenario links. If the DB has no data, run the loader first (Task 2).

**Step 4: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/app/page.tsx dashboard/components/charts/
git commit -m "feat(dashboard): add overview page with scorecard, chart, and model table"
```

---

## Task 6: Model Deep-Dive Page

**Files:**
- Create: `dashboard/app/models/[config]/page.tsx`

**Step 1: Create the model detail page**

Create `dashboard/app/models/[config]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConfigByName, getResultsForConfig, getAllConfigs } from "@/lib/queries";
import { StatCard } from "@/components/stat-card";
import { CweBadge } from "@/components/cwe-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ModelPage({
  params,
}: {
  params: Promise<{ config: string }>;
}) {
  const { config: configName } = await params;
  const config = getConfigByName(decodeURIComponent(configName));
  if (!config) notFound();

  const results = getResultsForConfig(config.id);

  // Group results by scenario × framework
  const grid: Record<string, Record<string, typeof results>> = {};
  const frameworks = new Set<string>();
  const safetyPrompts = new Set<string>();

  for (const r of results) {
    if (!grid[r.scenario]) grid[r.scenario] = {};
    if (!grid[r.scenario][`${r.framework}|${r.safety_prompt}`])
      grid[r.scenario][`${r.framework}|${r.safety_prompt}`] = [];
    grid[r.scenario][`${r.framework}|${r.safety_prompt}`].push(r);
    frameworks.add(r.framework);
    safetyPrompts.add(r.safety_prompt);
  }

  const sortedFrameworks = [...frameworks].sort();
  const sortedSafetyPrompts = [...safetyPrompts].sort();
  const scenarios = Object.keys(grid).sort();

  // CWE frequency
  const cweCount: Record<number, { num: number; desc: string; count: number }> = {};
  for (const r of results) {
    for (const cwe of r.cwes) {
      if (!cweCount[cwe.cwe_num]) cweCount[cwe.cwe_num] = { num: cwe.cwe_num, desc: cwe.cwe_desc, count: 0 };
      cweCount[cwe.cwe_num].count++;
    }
  }
  const topCwes = Object.values(cweCount).sort((a, b) => b.count - a.count);

  // Safety prompt comparison
  const safetyStats = sortedSafetyPrompts.map((sp) => {
    const spResults = results.filter((r) => r.safety_prompt === sp);
    const functional = spResults.filter((r) => r.functional_pass).length;
    const secure = spResults.filter((r) => r.functional_pass && r.cwes.length === 0).length;
    return {
      safety_prompt: sp,
      total: spResults.length,
      pass_at_1: spResults.length > 0 ? functional / spResults.length : 0,
      sec_pass_at_1: spResults.length > 0 ? secure / spResults.length : 0,
    };
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{config.name}</h1>
          <Badge variant={config.thinking ? "default" : "secondary"}>
            {config.thinking ? "thinking" : "standard"}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          Model: {config.model_id}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Results" value={config.total_results} />
        <StatCard title="pass@1" value={`${(config.pass_at_1 * 100).toFixed(1)}%`} />
        <StatCard title="sec_pass@1" value={`${(config.sec_pass_at_1 * 100).toFixed(1)}%`} />
        <StatCard title="Total CWEs" value={config.total_cwes} />
      </div>

      {/* Safety Prompt Comparison */}
      {safetyStats.length > 1 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Safety Prompt Effect</h2>
          <div className="grid grid-cols-3 gap-4">
            {safetyStats.map((s) => (
              <div key={s.safety_prompt} className="border rounded-lg p-4">
                <div className="text-sm font-medium text-muted-foreground capitalize">
                  {s.safety_prompt}
                </div>
                <div className="text-lg font-bold mt-1">
                  sec_pass@1: {(s.sec_pass_at_1 * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">
                  pass@1: {(s.pass_at_1 * 100).toFixed(1)}% ({s.total} results)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top CWEs */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Most Common Vulnerabilities</h2>
        <div className="flex flex-wrap gap-3">
          {topCwes.slice(0, 10).map((cwe) => (
            <Link key={cwe.num} href={`/cwes/${cwe.num}`}>
              <div className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer">
                <CweBadge num={cwe.num} />
                <div className="text-sm mt-1">{cwe.count} occurrences</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Per-Scenario Results */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Results by Scenario</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead>Framework</TableHead>
              <TableHead>Safety</TableHead>
              <TableHead>Functional</TableHead>
              <TableHead>Security Tests</TableHead>
              <TableHead>CWEs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/scenarios/${r.scenario}`}
                    className="text-blue-600 hover:underline"
                  >
                    {r.scenario}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{r.framework}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {r.safety_prompt}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className={r.functional_pass ? "text-green-600" : "text-red-600"}>
                    {r.functional_pass ? "PASS" : "FAIL"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({r.num_passed_ft}/{r.num_total_ft})
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {r.num_total_st - (r.num_st_exceptions ?? 0) - (r.cwes?.length ?? 0)}/{r.num_total_st} pass
                  {r.num_st_exceptions > 0 && (
                    <span className="text-amber-600 ml-1">({r.num_st_exceptions} err)</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.cwes.map((cwe, i) => (
                      <CweBadge key={i} num={cwe.cwe_num} desc={cwe.cwe_desc} />
                    ))}
                    {r.cwes.length === 0 && r.functional_pass && (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        Secure
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

**Step 2: Verify the page renders**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Navigate to `http://localhost:3000/models/haiku-4.5-standard` — should show model detail with stats, safety prompt comparison, CWE list, and results table.

**Step 3: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/app/models/
git commit -m "feat(dashboard): add model deep-dive page with safety prompt comparison"
```

---

## Task 7: CWE Explorer Page

**Files:**
- Create: `dashboard/app/cwes/page.tsx`
- Create: `dashboard/app/cwes/[id]/page.tsx`

**Step 1: Create the CWE list page**

Create `dashboard/app/cwes/page.tsx`:

```tsx
import Link from "next/link";
import { getCwesWithStats } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CwesPage() {
  const cwes = getCwesWithStats();
  const withOccurrences = cwes.filter((c) => c.occurrence_count > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">CWE Explorer</h1>
        <p className="text-muted-foreground mt-1">
          Vulnerability analysis across all models — {cwes.length} CWEs tracked
          ({cwes.filter((c) => c.is_extended).length} extended)
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>CWE</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Occurrences</TableHead>
            <TableHead>Worst Model</TableHead>
            <TableHead>Best Model</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {withOccurrences
            .sort((a, b) => b.occurrence_count - a.occurrence_count)
            .map((cwe) => (
              <TableRow key={cwe.num}>
                <TableCell>
                  <Link
                    href={`/cwes/${cwe.num}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    CWE-{cwe.num}
                  </Link>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{cwe.name}</TableCell>
                <TableCell>
                  <Badge variant={cwe.is_extended ? "default" : "secondary"}>
                    {cwe.is_extended ? "Extended" : "Original"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{cwe.occurrence_count}</TableCell>
                <TableCell className="text-sm text-red-600">{cwe.worst_config}</TableCell>
                <TableCell className="text-sm text-green-600">{cwe.best_config}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 2: Create the per-CWE detail page**

Create `dashboard/app/cwes/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCweDetail } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function CweDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = getCweDetail(parseInt(id));
  if (!data) notFound();

  const { cwe, byConfig, byScenario, byFramework } = data;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">CWE-{cwe.num}</h1>
          <Badge variant={cwe.is_extended ? "default" : "secondary"}>
            {cwe.is_extended ? "Extended" : "Original"}
          </Badge>
        </div>
        <p className="text-lg font-medium mt-2">{cwe.name}</p>
        <p className="text-muted-foreground mt-1 max-w-3xl">{cwe.description}</p>
        <a
          href={`https://cwe.mitre.org/data/definitions/${cwe.num}.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm mt-2 inline-block"
        >
          View on MITRE
        </a>
      </div>

      {/* By Model */}
      <div>
        <h2 className="text-xl font-semibold mb-4">By Model</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byConfig.map((row) => (
              <TableRow key={row.name}>
                <TableCell>
                  <Link href={`/models/${row.name}`} className="text-blue-600 hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{row.cnt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* By Scenario */}
      <div>
        <h2 className="text-xl font-semibold mb-4">By Scenario</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byScenario.map((row) => (
              <TableRow key={row.scenario}>
                <TableCell>
                  <Link href={`/scenarios/${row.scenario}`} className="text-blue-600 hover:underline">
                    {row.scenario}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{row.cnt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* By Framework */}
      <div>
        <h2 className="text-xl font-semibold mb-4">By Framework</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Framework</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byFramework.map((row) => (
              <TableRow key={row.framework}>
                <TableCell>{row.framework}</TableCell>
                <TableCell className="text-right">{row.cnt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

**Step 3: Verify both pages render**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Navigate to `http://localhost:3000/cwes` and `http://localhost:3000/cwes/693`.

**Step 4: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/app/cwes/
git commit -m "feat(dashboard): add CWE explorer and per-CWE detail pages"
```

---

## Task 8: Scenario Browser Page

**Files:**
- Create: `dashboard/app/scenarios/[id]/page.tsx`

**Step 1: Create the scenario detail page**

Create `dashboard/app/scenarios/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getScenarioResults, getPromptsForScenario } from "@/lib/queries";
import { CweBadge } from "@/components/cwe-badge";
import { CodeViewer } from "@/components/code-viewer";
import { LogViewer } from "@/components/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import fs from "fs";
import path from "path";

function readFileContent(relativePath: string): string | null {
  try {
    // Path is relative to repo root
    const fullPath = path.join(process.cwd(), "..", relativePath);
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

export default async function ScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scenario = decodeURIComponent(id);
  const results = getScenarioResults(scenario);
  const prompts = getPromptsForScenario(scenario);

  if (results.length === 0 && prompts.length === 0) notFound();

  const totalResults = results.length;
  const functionalPasses = results.filter((r) => r.functional_pass).length;
  const securePasses = results.filter(
    (r) => r.functional_pass && r.cwes.length === 0
  ).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{scenario}</h1>
        <p className="text-muted-foreground mt-1">
          {totalResults} results across all models and frameworks
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Total Results" value={totalResults} />
        <StatCard
          title="pass@1"
          value={`${totalResults > 0 ? ((functionalPasses / totalResults) * 100).toFixed(1) : 0}%`}
        />
        <StatCard
          title="sec_pass@1"
          value={`${totalResults > 0 ? ((securePasses / totalResults) * 100).toFixed(1) : 0}%`}
        />
      </div>

      {/* Prompts */}
      {prompts.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Prompts</h2>
          <Tabs defaultValue={prompts[0]?.safety_prompt ?? "none"}>
            <TabsList>
              {[...new Set(prompts.map((p) => p.safety_prompt))].map((sp) => (
                <TabsTrigger key={sp} value={sp} className="capitalize">
                  {sp}
                </TabsTrigger>
              ))}
            </TabsList>
            {[...new Set(prompts.map((p) => p.safety_prompt))].map((sp) => (
              <TabsContent key={sp} value={sp}>
                {prompts
                  .filter((p) => p.safety_prompt === sp)
                  .slice(0, 1)
                  .map((p) => (
                    <div key={p.id} className="mt-2">
                      <div className="text-sm text-muted-foreground mb-2">
                        Framework: {p.framework} | Spec: {p.spec_type}
                      </div>
                      <pre className="bg-zinc-950 text-zinc-300 p-4 rounded-md text-xs overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                        {p.prompt_text}
                      </pre>
                    </div>
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}

      {/* Results Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Results</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Framework</TableHead>
              <TableHead>Safety</TableHead>
              <TableHead>Functional</TableHead>
              <TableHead>Security</TableHead>
              <TableHead>CWEs</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/models/${r.config_name}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    {r.config_name}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{r.framework}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {r.safety_prompt}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className={r.functional_pass ? "text-green-600" : "text-red-600"}>
                    {r.functional_pass ? "PASS" : "FAIL"}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {r.num_total_st - (r.num_st_exceptions ?? 0) - r.cwes.length}/{r.num_total_st}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.cwes.map((cwe, i) => (
                      <CweBadge key={i} num={cwe.cwe_num} desc={cwe.cwe_desc} />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/results/${r.id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

**Step 2: Verify the page**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Navigate to `http://localhost:3000/scenarios/Login`.

**Step 3: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/app/scenarios/
git commit -m "feat(dashboard): add scenario browser with prompt viewer and results table"
```

---

## Task 9: Individual Result Detail Page

The deepest drill-down: view generated code, test results, logs for a single generation.

**Files:**
- Create: `dashboard/app/results/[id]/page.tsx`

**Step 1: Create the result detail page**

Create `dashboard/app/results/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResultById } from "@/lib/queries";
import { CweBadge } from "@/components/cwe-badge";
import { CodeViewer } from "@/components/code-viewer";
import { LogViewer } from "@/components/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import fs from "fs";
import path from "path";

function readFileContent(relativePath: string): string | null {
  try {
    const fullPath = path.join(process.cwd(), "..", relativePath);
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

function readCodeDir(relativePath: string): { name: string; content: string }[] {
  try {
    const dirPath = path.dirname(path.join(process.cwd(), "..", relativePath));
    const files = fs.readdirSync(dirPath);
    return files.map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(dirPath, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

function readTestLogs(testLogPath: string): { name: string; content: string }[] {
  try {
    const sampleDir = path.dirname(path.join(process.cwd(), "..", testLogPath));
    const files = fs.readdirSync(sampleDir).filter(
      (f) => (f.startsWith("sec_test_") || f.startsWith("func_test_")) && f.endsWith(".log")
    );
    return files.map((f) => ({
      name: f.replace(".log", ""),
      content: fs.readFileSync(path.join(sampleDir, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = getResultById(parseInt(id));
  if (!result) notFound();

  const codeFiles = result.code_path ? readCodeDir(result.code_path) : [];
  const testLog = result.test_log_path ? readFileContent(result.test_log_path) : null;
  const testLogs = result.test_log_path ? readTestLogs(result.test_log_path) : [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {result.scenario} / {result.framework}
        </h1>
        <div className="flex items-center gap-3 mt-2">
          <Link href={`/models/${result.config_name}`}>
            <Badge variant="outline">{result.config_name}</Badge>
          </Link>
          <Badge variant="outline" className="capitalize">
            safety: {result.safety_prompt}
          </Badge>
          <Badge variant="outline">sample {result.sample}</Badge>
        </div>
      </div>

      {/* Test Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Functional Tests</div>
          <div className={`text-xl font-bold ${result.functional_pass ? "text-green-600" : "text-red-600"}`}>
            {result.functional_pass ? "PASS" : "FAIL"}
          </div>
          <div className="text-sm text-muted-foreground">
            {result.num_passed_ft}/{result.num_total_ft} passed
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Security Tests</div>
          <div className="text-xl font-bold">
            {result.num_total_st - (result.num_st_exceptions ?? 0) - result.cwes.length}/{result.num_total_st}
          </div>
          <div className="text-sm text-muted-foreground">
            {result.num_st_exceptions > 0 && `${result.num_st_exceptions} exceptions`}
          </div>
        </div>
        <div className="border rounded-lg p-4 col-span-2">
          <div className="text-sm text-muted-foreground mb-2">CWEs Detected</div>
          {result.cwes.length === 0 ? (
            <Badge variant="outline" className="text-green-600 border-green-600">
              No vulnerabilities found
            </Badge>
          ) : (
            <div className="flex flex-wrap gap-2">
              {result.cwes.map((cwe, i) => (
                <Link key={i} href={`/cwes/${cwe.cwe_num}`}>
                  <div className="border border-red-200 bg-red-50 rounded px-2 py-1">
                    <span className="font-medium text-red-700 text-sm">CWE-{cwe.cwe_num}</span>
                    <p className="text-xs text-red-600 mt-0.5 max-w-xs truncate">{cwe.cwe_desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Generated Code */}
      {codeFiles.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Generated Code</h2>
          {codeFiles.map((file) => (
            <div key={file.name} className="mb-4">
              <CodeViewer code={file.content} filename={file.name} />
            </div>
          ))}
        </div>
      )}

      <Separator />

      {/* Individual Test Logs */}
      {testLogs.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Test Logs</h2>
          <div className="space-y-2">
            {testLogs.map((log) => (
              <LogViewer key={log.name} title={log.name} content={log.content} />
            ))}
          </div>
        </div>
      )}

      {/* Full Test Log */}
      {testLog && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Full Test Output</h2>
          <LogViewer title="test.log" content={testLog} />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify the page**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Navigate to a result from the scenario page (click "View" link).

**Step 3: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/app/results/
git commit -m "feat(dashboard): add result detail page with code viewer and test logs"
```

---

## Task 10: Comparisons Page

**Files:**
- Create: `dashboard/app/compare/page.tsx`
- Create: `dashboard/components/charts/safety-comparison-chart.tsx`

**Step 1: Create the safety comparison chart**

Create `dashboard/components/charts/safety-comparison-chart.tsx`:

```tsx
"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface SafetyComparisonChartProps {
  data: {
    config_name: string;
    none: number;
    generic: number;
    specific: number;
  }[];
}

export function SafetyComparisonChart({ data }: SafetyComparisonChartProps) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="config_name" angle={-35} textAnchor="end" fontSize={11} height={80} />
        <YAxis domain={[0, 100]} label={{ value: "%", position: "insideLeft" }} />
        <Tooltip formatter={(value: number) => `${value}%`} />
        <Legend />
        <Bar dataKey="none" name="No safety prompt" fill="#ef4444" />
        <Bar dataKey="generic" name="Generic" fill="#f59e0b" />
        <Bar dataKey="specific" name="Specific" fill="#22c55e" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

**Step 2: Create the comparisons page**

Create `dashboard/app/compare/page.tsx`:

```tsx
import {
  getThinkingComparison,
  getSafetyPromptComparison,
  getFrameworkComparison,
  getAllConfigs,
} from "@/lib/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { SafetyComparisonChart } from "@/components/charts/safety-comparison-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ComparePage() {
  const thinkingPairs = getThinkingComparison();
  const safetyData = getSafetyPromptComparison();
  const frameworkData = getFrameworkComparison();
  const allConfigs = getAllConfigs().filter((c) => c.total_results > 0);

  // Build safety chart data
  const safetyChartData: Record<string, { config_name: string; none: number; generic: number; specific: number }> = {};
  for (const row of safetyData) {
    if (!safetyChartData[row.config_name]) {
      safetyChartData[row.config_name] = { config_name: row.config_name, none: 0, generic: 0, specific: 0 };
    }
    const rate = row.total > 0 ? Math.round((row.secure_passes / row.total) * 1000) / 10 : 0;
    safetyChartData[row.config_name][row.safety_prompt as "none" | "generic" | "specific"] = rate;
  }

  // Framework comparison
  const fwByFramework: Record<string, typeof frameworkData> = {};
  for (const row of frameworkData) {
    if (!fwByFramework[row.framework]) fwByFramework[row.framework] = [];
    fwByFramework[row.framework].push(row);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Comparisons</h1>
        <p className="text-muted-foreground mt-1">
          Side-by-side analysis across dimensions
        </p>
      </div>

      <Tabs defaultValue="safety">
        <TabsList>
          <TabsTrigger value="safety">Safety Prompts</TabsTrigger>
          <TabsTrigger value="thinking">Thinking vs Standard</TabsTrigger>
          <TabsTrigger value="frameworks">Frameworks</TabsTrigger>
          <TabsTrigger value="tiers">Model Tiers</TabsTrigger>
        </TabsList>

        {/* Safety Prompts Tab */}
        <TabsContent value="safety" className="space-y-6">
          <h2 className="text-xl font-semibold">Effect of Safety Prompts on sec_pass@1</h2>
          {Object.values(safetyChartData).length > 0 && (
            <SafetyComparisonChart data={Object.values(safetyChartData)} />
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Config</TableHead>
                <TableHead className="text-right">None</TableHead>
                <TableHead className="text-right">Generic</TableHead>
                <TableHead className="text-right">Specific</TableHead>
                <TableHead className="text-right">Improvement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.values(safetyChartData).map((row) => (
                <TableRow key={row.config_name}>
                  <TableCell className="font-medium">{row.config_name}</TableCell>
                  <TableCell className="text-right">{row.none}%</TableCell>
                  <TableCell className="text-right">{row.generic}%</TableCell>
                  <TableCell className="text-right">{row.specific}%</TableCell>
                  <TableCell className="text-right">
                    <span className={row.specific > row.none ? "text-green-600" : "text-red-600"}>
                      {row.specific - row.none > 0 ? "+" : ""}
                      {(row.specific - row.none).toFixed(1)}pp
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* Thinking vs Standard Tab */}
        <TabsContent value="thinking" className="space-y-6">
          <h2 className="text-xl font-semibold">Thinking Mode vs Standard</h2>
          {thinkingPairs.length === 0 ? (
            <p className="text-muted-foreground">
              No thinking/standard pairs with results yet. Run benchmarks for both modes to see this comparison.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Standard sec_pass@1</TableHead>
                  <TableHead className="text-right">Thinking sec_pass@1</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thinkingPairs.map((pair) => {
                  const delta = pair.thinking.sec_pass_at_1 - pair.standard.sec_pass_at_1;
                  return (
                    <TableRow key={pair.standard.name}>
                      <TableCell className="font-medium">
                        {pair.standard.name.replace("-standard", "")}
                      </TableCell>
                      <TableCell className="text-right">
                        {(pair.standard.sec_pass_at_1 * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {(pair.thinking.sec_pass_at_1 * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : ""}>
                          {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}pp
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* Frameworks Tab */}
        <TabsContent value="frameworks" className="space-y-6">
          <h2 className="text-xl font-semibold">Framework Comparison</h2>
          {Object.entries(fwByFramework).map(([fw, rows]) => (
            <div key={fw}>
              <h3 className="text-lg font-medium mb-2">{fw}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Config</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">pass@1</TableHead>
                    <TableHead className="text-right">sec_pass@1</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.config_name}>
                      <TableCell>{row.config_name}</TableCell>
                      <TableCell className="text-right">{row.total}</TableCell>
                      <TableCell className="text-right">
                        {row.total > 0 ? ((row.functional_passes / row.total) * 100).toFixed(1) : 0}%
                      </TableCell>
                      <TableCell className="text-right">
                        {row.total > 0 ? ((row.secure_passes / row.total) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </TabsContent>

        {/* Model Tiers Tab */}
        <TabsContent value="tiers" className="space-y-6">
          <h2 className="text-xl font-semibold">Model Tiers</h2>
          <p className="text-muted-foreground">Haiku vs Sonnet vs Opus performance</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Config</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Results</TableHead>
                <TableHead className="text-right">pass@1</TableHead>
                <TableHead className="text-right">sec_pass@1</TableHead>
                <TableHead className="text-right">CWEs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allConfigs
                .sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1)
                .map((c) => {
                  const tier = c.name.includes("opus")
                    ? "Opus"
                    : c.name.includes("sonnet")
                    ? "Sonnet"
                    : "Haiku";
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{tier}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{c.total_results}</TableCell>
                      <TableCell className="text-right">
                        {(c.pass_at_1 * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {(c.sec_pass_at_1 * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">{c.total_cwes}</TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Step 3: Verify the page**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Navigate to `http://localhost:3000/compare` — verify all 4 tabs render.

**Step 4: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/app/compare/ dashboard/components/charts/safety-comparison-chart.tsx
git commit -m "feat(dashboard): add comparisons page with safety/thinking/framework/tier tabs"
```

---

## Task 11: Add `next.config.ts` Webpack Override for better-sqlite3

`better-sqlite3` is a native Node module that doesn't work with Webpack bundling. Next.js needs to be told to externalize it.

**Files:**
- Modify: `dashboard/next.config.ts`

**Step 1: Update next.config.ts**

Replace the content of `dashboard/next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

**Step 2: Verify build succeeds**

```bash
cd /Users/yassh/codestrike/dashboard
npm run build 2>&1 | tail -10
```

Expected: Build completes without `better-sqlite3` errors.

**Step 3: Commit**

```bash
cd /Users/yassh/codestrike
git add dashboard/next.config.ts
git commit -m "fix(dashboard): externalize better-sqlite3 from webpack bundling"
```

---

## Task 12: End-to-End Smoke Test

**Files:** None — this task verifies everything works together.

**Step 1: Load the database**

```bash
cd /Users/yassh/codestrike
pipenv run python scripts/load_results_db.py
```

Expected: Output shows loaded results, CWE definitions, configs.

**Step 2: Build the dashboard**

```bash
cd /Users/yassh/codestrike/dashboard
npm run build
```

Expected: Build succeeds with no errors.

**Step 3: Start the dashboard and verify all pages**

```bash
cd /Users/yassh/codestrike/dashboard
npm run dev
```

Verify these URLs in a browser:
- `http://localhost:3000` — Overview with scorecards, chart, model table
- `http://localhost:3000/models/haiku-4.5-standard` — Model deep-dive with results
- `http://localhost:3000/cwes` — CWE explorer list
- `http://localhost:3000/cwes/693` — CWE-693 detail page
- `http://localhost:3000/scenarios/Login` — Scenario with prompts and results
- `http://localhost:3000/compare` — All 4 comparison tabs
- Click "View" on any result in a scenario page — result detail with code and logs

**Step 4: Fix any issues discovered**

If pages crash or show errors, fix them and re-test.

**Step 5: Final commit**

```bash
cd /Users/yassh/codestrike
git add -A dashboard/
git commit -m "feat(dashboard): complete CodeStrike security dashboard v1"
```

---

## Task 13: Push to GitHub

**Step 1: Push all dashboard commits**

```bash
cd /Users/yassh/codestrike
git push origin feat/extended-security-tests
```

Expected: All commits pushed successfully.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Scaffold Next.js app | `dashboard/*` |
| 2 | Python data loader | `scripts/load_results_db.py` |
| 3 | DB connection + typed queries | `dashboard/lib/{db,queries,types}.ts` |
| 4 | Layout, nav, shared components | `dashboard/components/*.tsx` |
| 5 | Overview page | `dashboard/app/page.tsx` + chart |
| 6 | Model deep-dive | `dashboard/app/models/[config]/page.tsx` |
| 7 | CWE explorer | `dashboard/app/cwes/**` |
| 8 | Scenario browser | `dashboard/app/scenarios/[id]/page.tsx` |
| 9 | Result detail | `dashboard/app/results/[id]/page.tsx` |
| 10 | Comparisons | `dashboard/app/compare/page.tsx` + chart |
| 11 | Webpack config fix | `dashboard/next.config.ts` |
| 12 | E2E smoke test | Verification only |
| 13 | Push to GitHub | Git only |
