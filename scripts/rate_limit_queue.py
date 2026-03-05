#!/usr/bin/env python3
"""Rate-limited benchmark queue for BaxBench extended runs.

Schedules generation across 10 Claude model configs, handling 429 rate limits
with exponential backoff. Designed for Claude Max subscription (5hr rolling window).

Usage:
    python scripts/rate_limit_queue.py --config all
    python scripts/rate_limit_queue.py --config haiku-4.5-standard
    python scripts/rate_limit_queue.py --config opus-4-thinking --dry-run
"""
import argparse
import os
import subprocess
import sys
import time

MODEL_CONFIGS = [
    {"name": "opus-4-standard", "model": "claude-opus-4-20250514", "thinking": False},
    {"name": "opus-4-thinking", "model": "claude-opus-4-20250514", "thinking": True},
    # TODO: Update model IDs when Claude 4.5 Opus/Sonnet are available
    {"name": "opus-4.5-standard", "model": "claude-opus-4-5-20250218", "thinking": False},
    {"name": "opus-4.5-thinking", "model": "claude-opus-4-5-20250218", "thinking": True},
    {"name": "sonnet-4-standard", "model": "claude-sonnet-4-20250514", "thinking": False},
    {"name": "sonnet-4-thinking", "model": "claude-sonnet-4-20250514", "thinking": True},
    {"name": "sonnet-4.5-standard", "model": "claude-sonnet-4-5-20241022", "thinking": False},
    {"name": "sonnet-4.5-thinking", "model": "claude-sonnet-4-5-20241022", "thinking": True},
    {"name": "haiku-4.5-standard", "model": "claude-haiku-4-5-20251001", "thinking": False},
    {"name": "haiku-4.5-thinking", "model": "claude-haiku-4-5-20251001", "thinking": True},
]

FRAMEWORKS = ["Python-Flask", "JavaScript-Express", "Go-Fiber"]
SAFETY_PROMPTS = ["none", "generic", "specific"]

# All 28 scenario IDs
SCENARIOS = [
    "Calculator", "ClickCount", "Compiler", "CreditCardService", "FileSearch",
    "Forum", "FrameExtract", "ImageConverter", "ImageTransfer", "Logger",
    "Login", "Monitor", "PdfCat", "PdfToText", "ProductCatalog",
    "ProfileCollection", "Recipes", "RecommendationService", "RegexSearch",
    "SecretStorage", "ShopOverview", "ShoppingCartService", "SongDownloader",
    "Unsubscribe", "UptimeService", "UserCreation", "Wiki", "ZipToTxt",
]


def build_generation_commands(config: dict) -> list[str]:
    """Build all generation commands for a single model config."""
    cmds = []
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
                cmds.append(cmd)
    return cmds


def run_with_retry(cmd: str, env: dict, max_retries: int = 5) -> bool:
    """Run command with exponential backoff on rate limit errors."""
    for attempt in range(max_retries):
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env)
        if result.returncode == 0:
            return True
        stderr = result.stderr
        if "429" in stderr or "rate_limit" in stderr.lower() or "overloaded" in stderr.lower():
            wait = min(60 * (2 ** attempt), 600)  # Max 10 min
            print(f"  Rate limited. Waiting {wait}s (attempt {attempt + 1}/{max_retries})")
            time.sleep(wait)
        else:
            print(f"  Error: {stderr[:200]}")
            return False
    return False


def main():
    parser = argparse.ArgumentParser(description="Rate-limited BaxBench generation queue")
    parser.add_argument("--config", default="all", help="Config name or 'all'")
    parser.add_argument("--dry-run", action="store_true", help="Print commands only")
    args = parser.parse_args()

    configs = MODEL_CONFIGS
    if args.config != "all":
        configs = [c for c in MODEL_CONFIGS if c["name"] == args.config]
        if not configs:
            print(f"Unknown config: {args.config}")
            print(f"Available: {', '.join(c['name'] for c in MODEL_CONFIGS)}")
            sys.exit(1)

    for config in configs:
        cmds = build_generation_commands(config)
        print(f"\n=== {config['name']}: {len(cmds)} commands ===")

        # Set env vars for thinking mode control
        env = os.environ.copy()
        if not config["thinking"]:
            env["BAXBENCH_NO_THINKING"] = "1"
        elif "BAXBENCH_NO_THINKING" in env:
            del env["BAXBENCH_NO_THINKING"]

        succeeded = 0
        failed = 0
        for i, cmd in enumerate(cmds):
            if args.dry_run:
                thinking_label = "thinking" if config["thinking"] else "standard"
                print(f"  [{thinking_label}] {cmd}")
                continue
            print(f"[{i+1}/{len(cmds)}] {cmd.split('--scenarios ')[1].split(' --')[0]}...", end=" ", flush=True)
            if run_with_retry(cmd, env):
                print("OK")
                succeeded += 1
            else:
                print("FAILED")
                failed += 1

        if not args.dry_run:
            print(f"\n  Results: {succeeded} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
