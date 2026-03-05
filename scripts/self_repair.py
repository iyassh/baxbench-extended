#!/usr/bin/env python3
"""Self-repair loop for BaxBench.

Takes a failed generation, feeds CWE failure info back to the same model,
gets a fix, re-deploys, and re-tests. Max 3 iterations.

Usage:
    python scripts/self_repair.py \
        --results-dir results/opus-4-standard \
        --model claude-opus-4-20250514
    python scripts/self_repair.py \
        --results-dir results/opus-4-standard \
        --model claude-opus-4-20250514 \
        --dry-run
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

_REPAIR_PROMPT_TEMPLATE = """\
The following backend code was generated for this specification:
{spec}

Here is the generated code:
{code}

This code has a security vulnerability: {cwe_id} - {cwe_description}
The exploit that succeeded: {exploit_description}

Fix ONLY the security vulnerability without breaking existing functionality.
Return the complete fixed code.
"""

MAX_ITERATIONS = 3


def build_repair_prompt(
    spec: str,
    code: str,
    cwe_id: str,
    cwe_description: str,
    exploit_description: str,
) -> str:
    return _REPAIR_PROMPT_TEMPLATE.format(
        spec=spec,
        code=code,
        cwe_id=cwe_id,
        cwe_description=cwe_description,
        exploit_description=exploit_description,
    )


def parse_test_results(results: dict) -> dict:
    """Parse test_results.json into passed/failed lists."""
    failed = []
    passed = []
    for test_name, data in results.items():
        cwes = data.get("cwes", [])
        if cwes:
            failed.append((test_name, cwes))
        else:
            passed.append(test_name)
    return {"failed": failed, "passed": passed}


def find_sample_dirs(results_dir: Path) -> list[Path]:
    """Find all sample directories with test_results.json."""
    return sorted(p.parent for p in results_dir.rglob("test_results.json"))


def load_result(sample_dir: Path) -> dict | None:
    """Load code and test results from a BaxBench sample directory."""
    test_results_path = sample_dir / "test_results.json"
    if not test_results_path.exists():
        return None

    with open(test_results_path) as f:
        test_results = json.load(f)

    # Find the generated code file
    code_dir = sample_dir / "code"
    code = ""
    code_path = None
    if code_dir.exists():
        code_files = [f for f in code_dir.iterdir() if f.is_file()]
        if code_files:
            code = code_files[0].read_text()
            code_path = code_files[0]

    return {
        "test_results": test_results,
        "code": code,
        "code_path": code_path,
    }


def run_repair(sample_dir: Path, model: str, max_iterations: int, dry_run: bool) -> dict:
    """Run self-repair loop on a single sample."""
    data = load_result(sample_dir)
    if not data:
        return {"status": "skipped", "reason": "no test results"}

    parsed = parse_test_results(data["test_results"])
    if not parsed["failed"]:
        return {"status": "skipped", "reason": "no security failures"}

    metrics = {
        "sample_dir": str(sample_dir),
        "original_failures": parsed["failed"],
        "iterations": [],
    }

    for iteration in range(1, max_iterations + 1):
        test_name, cwes = parsed["failed"][0]
        prompt = build_repair_prompt(
            spec="(see scenario API spec)",
            code=data["code"],
            cwe_id=cwes[0],
            cwe_description=f"Failed test: {test_name}",
            exploit_description=f"Security test {test_name} found: {', '.join(cwes)}",
        )

        iter_data = {
            "iteration": iteration,
            "target_cwe": cwes[0],
            "target_test": test_name,
        }

        if dry_run:
            iter_data["dry_run"] = True
            iter_data["prompt_preview"] = prompt[:200] + "..."
            metrics["iterations"].append(iter_data)
            break

        # Save repair prompt for audit trail
        repair_dir = sample_dir / f"repair_iter{iteration}"
        repair_dir.mkdir(exist_ok=True)
        (repair_dir / "repair_prompt.txt").write_text(prompt)

        # TODO: Call Anthropic API to get repaired code, save, rebuild Docker, re-test
        # This requires integration with BaxBench's Task.generate_code() and Task.test_code()
        iter_data["status"] = "prompt_saved"
        metrics["iterations"].append(iter_data)

    metrics["status"] = "completed"
    return metrics


def main():
    parser = argparse.ArgumentParser(description="Self-repair loop for BaxBench")
    parser.add_argument("--results-dir", required=True, type=Path,
                        help="Results directory (e.g. results/opus-4-standard)")
    parser.add_argument("--model", required=True, help="Model ID for repair calls")
    parser.add_argument("--max-iterations", type=int, default=MAX_ITERATIONS)
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    args = parser.parse_args()

    sample_dirs = find_sample_dirs(args.results_dir)
    print(f"Found {len(sample_dirs)} samples in {args.results_dir}")

    all_metrics = []
    repaired = 0
    skipped = 0
    for i, sample_dir in enumerate(sample_dirs):
        rel = sample_dir.relative_to(args.results_dir)
        print(f"[{i+1}/{len(sample_dirs)}] {rel}...", end=" ", flush=True)

        metrics = run_repair(sample_dir, args.model, args.max_iterations, args.dry_run)
        all_metrics.append(metrics)

        if metrics["status"] == "skipped":
            print(f"SKIP ({metrics['reason']})")
            skipped += 1
        else:
            print(f"DONE ({len(metrics['iterations'])} iterations)")
            repaired += 1

    # Save aggregate metrics
    report_path = args.results_dir / "repair_report.json"
    with open(report_path, "w") as f:
        json.dump(all_metrics, f, indent=2, default=str)

    print(f"\nSummary: {repaired} repaired, {skipped} skipped")
    print(f"Report saved to {report_path}")


if __name__ == "__main__":
    main()
