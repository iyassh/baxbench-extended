#!/usr/bin/env python3
"""Analyze BaxBench extended benchmark results.

Generates comparison tables for:
- Old vs New (same tier)
- Thinking vs Standard (same model)
- Tier comparison (Haiku vs Sonnet vs Opus)
- Per-CWE occurrence rates

Usage:
    python scripts/analyze_results.py --results-dir results/
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def compute_pass_at_1(results: list[dict]) -> float:
    """Compute pass@1: fraction of functionally correct generations."""
    if not results:
        return 0.0
    return sum(1 for r in results if r.get("functional_pass")) / len(results)


def compute_sec_pass_at_1(results: list[dict]) -> float:
    """Compute sec_pass@1: fraction that pass functionally AND have no CWEs."""
    if not results:
        return 0.0
    secure = sum(
        1 for r in results
        if r.get("functional_pass") and not r.get("cwes")
    )
    return secure / len(results)


def collect_cwe_counts(results: list[dict]) -> dict[str, int]:
    """Count occurrences of each CWE across results."""
    counts: dict[str, int] = defaultdict(int)
    for r in results:
        for cwe in r.get("cwes", []):
            counts[cwe] += 1
    return dict(counts)


def load_all_results(results_dir: Path) -> dict[str, list[dict]]:
    """Load test_results.json from all config directories."""
    all_data: dict[str, list[dict]] = {}
    for config_dir in sorted(results_dir.iterdir()):
        if not config_dir.is_dir() or config_dir.name.startswith("."):
            continue
        config_name = config_dir.name
        results = []
        for result_file in config_dir.rglob("test_results.json"):
            with open(result_file) as f:
                data = json.load(f)
                results.append(data)
        if results:
            all_data[config_name] = results
    return all_data


def print_overall_table(data: dict[str, list[dict]]):
    """Print overall comparison table."""
    print("## Overall Comparison\n")
    print("| Config | pass@1 | sec_pass@1 | Tasks |")
    print("|--------|--------|------------|-------|")
    for config in sorted(data.keys()):
        results = data[config]
        p1 = compute_pass_at_1(results)
        sp1 = compute_sec_pass_at_1(results)
        print(f"| {config} | {p1:.3f} | {sp1:.3f} | {len(results)} |")


def print_thinking_comparison(data: dict[str, list[dict]]):
    """Compare thinking vs standard for same models."""
    print("\n## Thinking vs Standard\n")
    print("| Model | Standard sec_pass@1 | Thinking sec_pass@1 | Delta |")
    print("|-------|--------------------|--------------------|-------|")

    bases = set()
    for config in data:
        base = config.replace("-standard", "").replace("-thinking", "")
        bases.add(base)

    for base in sorted(bases):
        std_key = f"{base}-standard"
        think_key = f"{base}-thinking"
        if std_key in data and think_key in data:
            std_sp1 = compute_sec_pass_at_1(data[std_key])
            think_sp1 = compute_sec_pass_at_1(data[think_key])
            delta = think_sp1 - std_sp1
            sign = "+" if delta >= 0 else ""
            print(f"| {base} | {std_sp1:.3f} | {think_sp1:.3f} | {sign}{delta:.3f} |")


def print_cwe_breakdown(data: dict[str, list[dict]]):
    """Print per-CWE occurrence rates."""
    print("\n## Per-CWE Occurrence Rates\n")

    # Collect all CWE types
    all_cwes: set[str] = set()
    for results in data.values():
        for r in results:
            all_cwes.update(r.get("cwes", []))

    if not all_cwes:
        print("No CWEs found in results.\n")
        return

    sorted_cwes = sorted(all_cwes)
    header = "| Config | " + " | ".join(sorted_cwes) + " |"
    sep = "|--------|" + "|".join("---" for _ in sorted_cwes) + "|"
    print(header)
    print(sep)

    for config in sorted(data.keys()):
        counts = collect_cwe_counts(data[config])
        total = len(data[config])
        row = f"| {config} |"
        for cwe in sorted_cwes:
            rate = counts.get(cwe, 0) / total if total else 0
            row += f" {rate:.2f} |"
        print(row)


def main():
    parser = argparse.ArgumentParser(description="Analyze BaxBench extended results")
    parser.add_argument("--results-dir", type=Path, default=Path("results"))
    parser.add_argument("--output", type=Path, help="Save markdown report to file")
    args = parser.parse_args()

    data = load_all_results(args.results_dir)
    if not data:
        print("No results found in", args.results_dir)
        return

    print("# BaxBench Extended Results\n")
    print_overall_table(data)
    print_thinking_comparison(data)
    print_cwe_breakdown(data)


if __name__ == "__main__":
    main()
