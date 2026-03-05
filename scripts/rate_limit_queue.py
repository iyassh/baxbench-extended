#!/usr/bin/env python3
"""Rate-limited benchmark queue for BaxBench extended runs.

Schedules generation across 10 Claude model configs, handling 429 rate limits
with exponential backoff. Designed for Claude Max subscription (5hr rolling window).

**Checkpoint/Resume:** Automatically skips scenarios that already have generated
code in the results directory. If you hit a usage limit, just re-run the same
command and it picks up where it left off.

Usage:
    python scripts/rate_limit_queue.py --config haiku-4.5-standard
    python scripts/rate_limit_queue.py --config haiku-4.5-thinking
    python scripts/rate_limit_queue.py --config all
    python scripts/rate_limit_queue.py --config haiku-4.5-standard --dry-run
    python scripts/rate_limit_queue.py --config haiku-4.5-standard --reset  # clear checkpoint, regenerate all
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

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

FRAMEWORKS = ["Python-Flask", "JavaScript-express", "Go-Fiber"]
SAFETY_PROMPTS = ["none", "generic", "specific"]

# All 28 scenario IDs
SCENARIOS = [
    "Calculator", "ClickCount", "Compiler", "CreditCardService", "FileSearch",
    "Forum", "FrameExtract", "ImageConverter", "ImageTransfer", "Logger",
    "Login", "Monitor", "PDFCat", "PDFToText", "ProductCatalog",
    "ProfileCollection", "Recipes", "RecommendationService", "RegexSearch",
    "SecretStorage", "ShopOverview", "ShoppingCartService", "SongDownloader",
    "Unsubscribe", "UptimeService", "UserCreation", "Wiki", "ZipToTxt",
]


def esc(s: str) -> str:
    """Match BaxBench's path escaping (tasks.py uses this for dir names)."""
    return s


def check_already_generated(config: dict, scenario: str, env: str, safety: str) -> bool:
    """Check if this generation already has output in the results directory."""
    # BaxBench saves to: results/<config>/<model>/<scenario>/<env>/temp0.2-openapi-<safety>/sample0/code/
    results_base = Path(f"results/{config['name']}")
    code_dir = (
        results_base / config["model"] / scenario / env
        / f"temp0.2-openapi-{safety}" / "sample0" / "code"
    )
    if code_dir.exists() and any(code_dir.iterdir()):
        return True
    return False


def build_generation_tasks(config: dict) -> list[dict]:
    """Build all generation tasks for a single model config, with metadata."""
    tasks = []
    for scenario in SCENARIOS:
        for env in FRAMEWORKS:
            for safety in SAFETY_PROMPTS:
                cmd = (
                    f"pipenv run python src/main.py"
                    f" --models {config['model']}"
                    f" --mode generate"
                    f" --scenarios {scenario}"
                    f" --envs {env}"
                    f" --safety_prompt {safety}"
                    f" --n_samples 1"
                    f" --temperature 0.2"
                    f" --results_dir results/{config['name']}"
                )
                tasks.append({
                    "cmd": cmd,
                    "scenario": scenario,
                    "env": env,
                    "safety": safety,
                })
    return tasks


def get_checkpoint_path(config_name: str) -> Path:
    """Get checkpoint file path for a config."""
    return Path(f"results/{config_name}/.checkpoint.json")


def load_checkpoint(config_name: str) -> dict:
    """Load checkpoint state."""
    cp_path = get_checkpoint_path(config_name)
    if cp_path.exists():
        with open(cp_path) as f:
            return json.load(f)
    return {"completed": [], "failed": [], "last_index": 0}


def save_checkpoint(config_name: str, state: dict):
    """Save checkpoint state."""
    cp_path = get_checkpoint_path(config_name)
    cp_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cp_path, "w") as f:
        json.dump(state, f, indent=2)


def task_key(task: dict) -> str:
    """Unique key for a generation task."""
    return f"{task['scenario']}/{task['env']}/{task['safety']}"


def run_with_retry(cmd: str, env: dict, max_retries: int = 5) -> tuple[bool, bool]:
    """Run command with exponential backoff on rate limit errors.

    Returns (success, hit_usage_limit). hit_usage_limit=True means we exhausted
    all retries on rate limits and should pause the whole run.
    """
    for attempt in range(max_retries):
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env)
        if result.returncode == 0:
            return True, False
        stderr = result.stderr
        if "429" in stderr or "rate_limit" in stderr.lower() or "overloaded" in stderr.lower():
            if attempt < max_retries - 1:
                wait = min(60 * (2 ** attempt), 600)  # Max 10 min
                print(f"\n  Rate limited. Waiting {wait}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
            else:
                print(f"\n  Usage limit hit after {max_retries} retries.")
                return False, True  # Signal to stop the whole run
        else:
            print(f"\n  Error: {stderr[:200]}")
            return False, False
    return False, True


def main():
    parser = argparse.ArgumentParser(
        description="Rate-limited BaxBench generation queue with checkpoint/resume"
    )
    parser.add_argument("--config", default="all", help="Config name or 'all'")
    parser.add_argument("--dry-run", action="store_true", help="Print commands only")
    parser.add_argument("--reset", action="store_true", help="Clear checkpoint and regenerate all")
    args = parser.parse_args()

    configs = MODEL_CONFIGS
    if args.config != "all":
        configs = [c for c in MODEL_CONFIGS if c["name"] == args.config]
        if not configs:
            print(f"Unknown config: {args.config}")
            print(f"Available: {', '.join(c['name'] for c in MODEL_CONFIGS)}")
            sys.exit(1)

    for config in configs:
        tasks = build_generation_tasks(config)
        total = len(tasks)

        # Load or reset checkpoint
        if args.reset:
            state = {"completed": [], "failed": [], "last_index": 0}
            save_checkpoint(config["name"], state)
            print(f"\n=== {config['name']}: RESET — {total} tasks ===")
        else:
            state = load_checkpoint(config["name"])
            print(f"\n=== {config['name']}: {total} tasks ===")

        completed_keys = set(state["completed"])

        # Set env vars for thinking mode control and proxy routing
        env = os.environ.copy()
        if not config["thinking"]:
            env["BAXBENCH_NO_THINKING"] = "1"
        elif "BAXBENCH_NO_THINKING" in env:
            del env["BAXBENCH_NO_THINKING"]

        # Default to CLIProxyAPI if no direct Anthropic key is set
        if "ANTHROPIC_API_KEY" not in env and "BAXBENCH_PROXY_URL" not in env:
            env["BAXBENCH_PROXY_URL"] = "http://localhost:8317/v1"
            env["BAXBENCH_PROXY_KEY"] = "baxbench-local-key"

        succeeded = len(completed_keys)
        failed = 0
        skipped = 0

        for i, task in enumerate(tasks):
            key = task_key(task)

            # Skip if already completed (checkpoint or existing output)
            if key in completed_keys:
                skipped += 1
                continue
            if check_already_generated(config, task["scenario"], task["env"], task["safety"]):
                skipped += 1
                state["completed"].append(key)
                completed_keys.add(key)
                save_checkpoint(config["name"], state)
                continue

            if args.dry_run:
                thinking_label = "thinking" if config["thinking"] else "standard"
                print(f"  [{thinking_label}] {task['cmd']}")
                continue

            remaining = total - succeeded - failed - skipped
            print(
                f"[{succeeded + failed + 1}/{total}] "
                f"(done={succeeded}, skip={skipped}, left={remaining}) "
                f"{task['scenario']}/{task['env']}/{task['safety']}...",
                end=" ", flush=True,
            )

            ok, usage_limit = run_with_retry(task["cmd"], env)
            if ok:
                print("OK")
                succeeded += 1
                state["completed"].append(key)
                state["last_index"] = i
                save_checkpoint(config["name"], state)
            elif usage_limit:
                # Save checkpoint and stop — user can resume later
                state["last_index"] = i
                save_checkpoint(config["name"], state)
                print(f"\n{'='*60}")
                print(f"  PAUSED: Usage limit reached for {config['name']}")
                print(f"  Progress: {succeeded}/{total} succeeded, {skipped} skipped, {failed} failed")
                print(f"  Checkpoint saved. Resume with:")
                print(f"    python scripts/rate_limit_queue.py --config {config['name']}")
                print(f"{'='*60}")
                return  # Exit entirely — user re-runs when limit resets
            else:
                print("FAILED")
                failed += 1
                state["failed"].append(key)
                state["last_index"] = i
                save_checkpoint(config["name"], state)

        if not args.dry_run:
            print(f"\n  Results: {succeeded} succeeded, {skipped} skipped, {failed} failed (total {total})")
            if succeeded + skipped == total:
                print(f"  CONFIG COMPLETE: {config['name']}")


if __name__ == "__main__":
    main()
