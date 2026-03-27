#!/usr/bin/env python3
"""Load BaxBench results/ directory into dashboard/baxbench.db (SQLite).

Idempotent: drops and recreates all tables on each run.

Usage:
    pipenv run python scripts/load_results_db.py
    pipenv run python scripts/load_results_db.py --results-dir results --db dashboard/baxbench.db
"""
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

# Add src/ to path so we can import BaxBench modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from cwes import CWE

# Model configs — must match rate_limit_queue.py
MODEL_CONFIGS = [
    {"name": "opus-4-standard", "model": "claude-opus-4-20250514", "thinking": False},
    {"name": "opus-4-thinking", "model": "claude-opus-4-20250514", "thinking": True},
    {"name": "opus-4.1-standard", "model": "claude-opus-4-1-20250805", "thinking": False},
    {"name": "opus-4.1-thinking", "model": "claude-opus-4-1-20250805", "thinking": True},
    {"name": "opus-4.5-standard", "model": "claude-opus-4-5-20251101", "thinking": False},
    {"name": "opus-4.5-thinking", "model": "claude-opus-4-5-20251101", "thinking": True},
    {"name": "opus-4.6-standard", "model": "claude-opus-4-6", "thinking": False},
    {"name": "opus-4.6-thinking", "model": "claude-opus-4-6", "thinking": True},
    {"name": "sonnet-4-standard", "model": "claude-sonnet-4-20250514", "thinking": False},
    {"name": "sonnet-4-thinking", "model": "claude-sonnet-4-20250514", "thinking": True},
    {"name": "sonnet-4.5-standard", "model": "claude-sonnet-4-5-20250929", "thinking": False},
    {"name": "sonnet-4.5-thinking", "model": "claude-sonnet-4-5-20250929", "thinking": True},
    {"name": "sonnet-4.6-standard", "model": "claude-sonnet-4-6", "thinking": False},
    {"name": "sonnet-4.6-thinking", "model": "claude-sonnet-4-6", "thinking": True},
    {"name": "haiku-4.5-standard", "model": "claude-haiku-4-5-20251001", "thinking": False},
    {"name": "haiku-4.5-thinking", "model": "claude-haiku-4-5-20251001", "thinking": True},
    # Ollama models (free local)
    {"name": "deepseek-coder-6.7b-ollama", "model": "deepseek-coder:6.7b", "thinking": False},
    # OpenRouter models (free cloud)
    {"name": "meta-llama-llama-3.3-70b-instruct-openrouter", "model": "meta-llama-llama-3.3-70b-instruct", "thinking": False},
    {"name": "mistralai-mistral-small-3.1-24b-instruct-openrouter", "model": "mistralai-mistral-small-3.1-24b-instruct", "thinking": False},
    {"name": "google-gemma-3-27b-it-openrouter", "model": "google-gemma-3-27b-it", "thinking": False},
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

# Original BaxBench CWEs (before our extension)
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
    """Insert all model configs. Returns name -> config_id mapping."""
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
    """Generate and store prompt text for each scenario x framework x safety_prompt combo.

    This imports BaxBench scenario modules and calls build_prompt().
    """
    try:
        from scenarios import all_scenarios as SCENARIO_OBJECTS
        from env import all_envs
    except ImportError:
        print("  WARN: Could not import BaxBench scenarios. Skipping prompt loading.")
        print("  (Run from the baxbench root directory with: pipenv run python scripts/load_results_db.py)")
        return

    env_map = {e.id: e for e in all_envs}
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
    parser = argparse.ArgumentParser(description="Load BaxBench results into SQLite for the dashboard")
    parser.add_argument("--results-dir", default="results", help="Path to results/ directory")
    parser.add_argument("--db", default="dashboard/baxbench.db", help="Output SQLite database path")
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
