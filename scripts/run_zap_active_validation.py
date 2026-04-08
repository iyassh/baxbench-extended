#!/usr/bin/env python3
"""Run OWASP ZAP ACTIVE scans against 50 selected BaxBench apps.

Validates BaxBench automated results by comparing with industry-standard scanner.
Uses zap-api-scan.py with -a flag for active attack payloads.

Usage:
    python scripts/run_zap_active_validation.py
    python scripts/run_zap_active_validation.py --limit 10  # just first 10
    python scripts/run_zap_active_validation.py --resume     # skip already scanned
"""
import argparse
import io
import json
import os
import pathlib
import shutil
import socket
import tarfile
import time
import uuid
from collections import defaultdict
from datetime import datetime

import docker

ROOT = pathlib.Path(__file__).parent.parent
RESULTS_DIR = ROOT / "results"
REPORT_PATH = ROOT / "docs" / "ZAP_ACTIVE_VALIDATION_REPORT.md"
ZAP_IMAGE = "ghcr.io/zaproxy/zaproxy:stable"

CWE_NAMES = {
    20: "Input Validation", 22: "Path Traversal", 78: "OS Injection",
    79: "XSS", 89: "SQL Injection", 94: "Code Injection",
    117: "Log Injection", 209: "Error Leakage", 284: "Access Control",
    287: "Auth Failure", 307: "Brute Force", 345: "JWT Alg None",
    347: "JWT Weak Secret", 352: "CSRF", 400: "Resource Exhaustion",
    434: "File Upload", 497: "System Info Leak", 522: "Weak Credentials",
    524: "Cacheable Response", 611: "XXE", 613: "Session Expiry",
    614: "No HttpOnly", 636: "Fail Open", 639: "IDOR",
    640: "Weak Recovery", 693: "Missing Headers", 798: "Hardcoded Creds",
    840: "Business Logic", 862: "Missing Auth", 915: "Mass Assignment",
    918: "SSRF", 942: "CORS", 1021: "Clickjacking", 1275: "No SameSite",
}

# Dockerfile templates
DOCKERFILES = {
    "Python-Flask": """FROM python:3.12-bookworm
RUN apt-get update && apt-get install -y sqlite3
RUN pip install flask pyjwt bcrypt passlib
RUN mkdir -p /app
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt 2>/dev/null || true
COPY app.py /app/app.py
ENV APP_SECRET=supers3cret
ENTRYPOINT ["python3", "app.py"]""",

    "JavaScript-express": """FROM node:22-bookworm
RUN apt-get update && apt-get install -y sqlite3
RUN mkdir -p /app
WORKDIR /app
COPY package.json /app/package.json
RUN npm install
COPY app.js /app/app.js
ENV APP_SECRET=supers3cret
ENTRYPOINT ["node", "app.js"]""",

    "Go-Fiber": """FROM golang:1.24-bookworm
RUN apt-get update && apt-get install -y sqlite3 gcc build-essential
RUN go install golang.org/x/tools/cmd/goimports@v0.36.0
RUN mkdir -p /app
WORKDIR /app
COPY . /app/
RUN test -f go.mod && go get myapp && go install && CGO_ENABLED=1 go build . || true
RUN test -f go.mod && goimports -w . && go mod tidy 2>/dev/null && CGO_ENABLED=1 go build . || true
ENV APP_SECRET=supers3cret
ENTRYPOINT ["./myapp"]""",
}

MANIFEST_FILES = {
    "Python-Flask": {"requirements.txt": "flask\npyjwt[crypto]\nbcrypt\npasslib\n"},
    "JavaScript-express": {"package.json": json.dumps({"dependencies": {
        "express": "^4.18.0", "better-sqlite3": "^11.0.0",
        "bcryptjs": "^2.4.3", "jsonwebtoken": "^9.0.0",
        "uuid": "^9.0.0", "cookie-parser": "^1.4.6", "cors": "^2.8.5"
    }})},
    "Go-Fiber": {
        "go.mod": "module myapp\n\ngo 1.23.4\n\nrequire github.com/gofiber/fiber/v2 v2.52.6\nrequire github.com/mattn/go-sqlite3 v1.14.24\nrequire github.com/golang-jwt/jwt/v5 v5.2.1\nrequire github.com/google/uuid v1.6.0\nrequire golang.org/x/crypto v0.32.0\n",
        "build_helper.go": 'package main\n\nimport (\n  "fmt"\n  _ "github.com/mattn/go-sqlite3"\n  _ "github.com/golang-jwt/jwt/v5"\n  _ "github.com/google/uuid"\n  _ "golang.org/x/crypto/bcrypt"\n  _ "github.com/gofiber/fiber/v2"\n)\n\nfunc main() {\n  fmt.Println("build helper")\n}\n',
    },
}


def select_apps(limit=50, skip_models=None):
    """Select apps with real CWEs, covering diverse models and scenarios."""
    skip_models = skip_models or []
    apps = []
    for tf in sorted(RESULTS_DIR.glob("**/test_results.json")):
        r = json.load(open(tf))
        cwes = [c["num"] if isinstance(c, dict) else c for c in r.get("cwes", [])]
        real_cwes = [c for c in cwes if c != 693]
        func_pass = r.get("num_passed_ft", 0) == r.get("num_total_ft", 1) and r.get("num_total_ft", 0) > 0

        if not func_pass or not cwes:
            continue

        # Get path relative to results dir
        rel = tf.relative_to(RESULTS_DIR)
        parts = str(rel).split("/")
        # parts: [config, model_id, scenario, framework, temp..., sample0, test_results.json]
        config = parts[0]

        # Skip models that match any skip pattern
        if any(s.lower() in config.lower() for s in skip_models):
            continue

        apps.append({
            "config": config, "scenario": parts[2], "fw": parts[3],
            "safety": parts[4].replace("temp0.2-openapi-", ""),
            "cwes": cwes, "real_cwes": real_cwes,
            "sample_dir": str(tf.parent),
            "score": len(real_cwes) * 10 + len(cwes),
        })

    apps.sort(key=lambda x: -x["score"])

    selected = []
    seen_configs = defaultdict(int)
    seen_scenarios = defaultdict(int)
    seen_frameworks = defaultdict(int)

    # Prioritize Flask and Express (more reliable Docker builds)
    # Then fill with Go if needed
    flask_first = sorted(apps, key=lambda x: (0 if "Flask" in x["fw"] else 1 if "express" in x["fw"] else 2, -x["score"]))

    for app in flask_first:
        if len(selected) >= limit:
            break
        if seen_configs[app["config"]] >= 4:
            continue
        if seen_scenarios[app["scenario"]] >= 3:
            continue
        if seen_frameworks[app["fw"]] >= limit * 0.5:  # No single framework > 50%
            continue
        selected.append(app)
        seen_configs[app["config"]] += 1
        seen_scenarios[app["scenario"]] += 1
        seen_frameworks[app["fw"]] += 1

    return selected


def get_free_port():
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def build_and_start(app):
    """Build Docker image and start container. Returns (container, port) or (None, None)."""
    client = docker.from_env()
    code_dir = pathlib.Path(app["sample_dir"]) / "code"

    if not code_dir.exists():
        return None, None

    fw = app["fw"]
    fw_base = "Python-Flask" if "Flask" in fw else "JavaScript-express" if "express" in fw else "Go-Fiber"

    build_dir = pathlib.Path(f"/tmp/zap-build-{uuid.uuid4().hex[:8]}")
    build_dir.mkdir(parents=True, exist_ok=True)

    try:
        for f in code_dir.iterdir():
            if f.is_file() and not f.name.startswith("."):
                shutil.copy2(f, build_dir / f.name)

        for filename, content in MANIFEST_FILES.get(fw_base, {}).items():
            if not (build_dir / filename).exists():
                (build_dir / filename).write_text(content)

        dockerfile_content = DOCKERFILES[fw_base]
        (build_dir / "Dockerfile").write_text(dockerfile_content)
        print(f"    Using {fw_base} Dockerfile (base: {dockerfile_content.split(chr(10))[0]})")
        print(f"    Build dir: {list(build_dir.iterdir())}")

        tag = f"zap-target-{uuid.uuid4().hex[:8]}"
        image, _ = client.images.build(path=str(build_dir), tag=tag, rm=True, nocache=True, timeout=300)

        port = get_free_port()
        container = client.containers.run(
            image.id, detach=True,
            ports={"5000/tcp": port},
            mem_limit="1g",
            name=f"zap-target-{uuid.uuid4().hex[:8]}",
        )

        # Health check
        import requests
        for _ in range(60):
            try:
                requests.get(f"http://localhost:{port}/", timeout=2)
                return container, port
            except:
                time.sleep(1)

        return container, port  # Return anyway, might work

    except Exception as e:
        print(f"    Build failed: {e}")
        return None, None
    finally:
        shutil.rmtree(build_dir, ignore_errors=True)


def run_zap_active_scan(port, report_dir):
    """Run ZAP active scan against app on given port. Returns parsed alerts."""
    client = docker.from_env()
    report_dir = pathlib.Path(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)

    try:
        zap_container = client.containers.run(
            ZAP_IMAGE,
            command=(
                f"zap-full-scan.py "
                f"-t http://host.docker.internal:{port}/ "
                f"-J /zap/wrk/zap_active_report.json "
                f"-r /zap/wrk/zap_active_report.html "
                f"-I -m 5"
            ),
            detach=True,
            user="root",
            extra_hosts={"host.docker.internal": "host-gateway"},
            volumes={str(report_dir.resolve()): {"bind": "/zap/wrk", "mode": "rw"}},
        )

        # Wait for completion (max 30 min)
        result = zap_container.wait(timeout=1800)
        exit_code = result.get("StatusCode", -1)

        # Clean up ZAP container
        try:
            zap_container.remove(force=True)
        except:
            pass

        # Parse report
        report_file = report_dir / "zap_active_report.json"
        if report_file.exists():
            data = json.load(open(report_file))
            alerts = []
            for site in data.get("site", []):
                for alert in site.get("alerts", []):
                    cwe = alert.get("cweid", "0")
                    alerts.append({
                        "name": alert.get("name", ""),
                        "risk": alert.get("riskdesc", ""),
                        "riskcode": int(alert.get("riskcode", 0)),
                        "cweid": int(cwe) if cwe and cwe != "-1" else 0,
                        "pluginid": alert.get("pluginid", ""),
                        "instances": len(alert.get("instances", [])),
                        "confidence": alert.get("confidence", ""),
                    })
            return alerts, exit_code
        else:
            return [], exit_code

    except Exception as e:
        print(f"    ZAP scan failed: {e}")
        return [], -1


def compare_results(baxbench_cwes, zap_alerts):
    """Compare BaxBench and ZAP findings. Returns comparison dict."""
    zap_cwes = {a["cweid"] for a in zap_alerts if a["cweid"] > 0}
    bax_set = set(baxbench_cwes)

    both = bax_set & zap_cwes
    bax_only = bax_set - zap_cwes
    zap_only = zap_cwes - bax_set

    return {
        "both_found": sorted(both),
        "baxbench_only": sorted(bax_only),
        "zap_only": sorted(zap_only),
        "baxbench_cwes": sorted(bax_set),
        "zap_cwes": sorted(zap_cwes),
        "agreement": len(both) / len(bax_set) * 100 if bax_set else 0,
    }


def generate_report(all_results, report_path=None):
    """Generate markdown validation report."""
    report_path = report_path or REPORT_PATH
    lines = []
    lines.append("# ZAP Active Scan Validation Report\n")
    lines.append(f"**Date:** {datetime.utcnow().strftime('%Y-%m-%d')}\n")
    lines.append(f"**Apps scanned:** {len(all_results)}\n")
    lines.append(f"**Scan type:** ZAP Active Scan (`zap-api-scan.py -a`)\n")
    lines.append(f"**Scan strength:** Default (medium)\n")
    lines.append("")

    # Aggregate stats
    total_bax = total_zap = total_both = total_bax_only = total_zap_only = 0
    cwe_agreement = defaultdict(lambda: {"both": 0, "bax_only": 0, "zap_only": 0})

    for r in all_results:
        comp = r["comparison"]
        total_both += len(comp["both_found"])
        total_bax_only += len(comp["baxbench_only"])
        total_zap_only += len(comp["zap_only"])

        for c in comp["both_found"]:
            cwe_agreement[c]["both"] += 1
        for c in comp["baxbench_only"]:
            cwe_agreement[c]["bax_only"] += 1
        for c in comp["zap_only"]:
            cwe_agreement[c]["zap_only"] += 1

    total_bax = total_both + total_bax_only
    total_zap = total_both + total_zap_only

    lines.append("## Executive Summary\n")
    lines.append(f"| Metric | Count |")
    lines.append(f"|---|---|")
    lines.append(f"| BaxBench total findings | {total_bax} |")
    lines.append(f"| ZAP total findings | {total_zap} |")
    lines.append(f"| **Both agree (True Positives)** | **{total_both}** |")
    lines.append(f"| BaxBench only (ZAP missed) | {total_bax_only} |")
    lines.append(f"| ZAP only (BaxBench missed) | {total_zap_only} |")

    if total_bax > 0:
        lines.append(f"| **BaxBench validation rate** | **{total_both/total_bax*100:.1f}%** |")
    lines.append("")

    # Per-CWE agreement
    lines.append("## Per-CWE Agreement Rate\n")
    lines.append("| CWE | Name | Both Found | BaxBench Only | ZAP Only | Agreement |")
    lines.append("|---|---|---|---|---|---|")

    for cwe in sorted(cwe_agreement.keys()):
        d = cwe_agreement[cwe]
        total = d["both"] + d["bax_only"]
        rate = d["both"] / total * 100 if total > 0 else 0
        name = CWE_NAMES.get(cwe, f"CWE-{cwe}")
        lines.append(f"| CWE-{cwe} | {name} | {d['both']} | {d['bax_only']} | {d['zap_only']} | {rate:.0f}% |")

    # Per-app details
    lines.append("\n## Per-App Results\n")
    for r in all_results:
        app = r["app"]
        comp = r["comparison"]
        lines.append(f"### {app['config']} / {app['scenario']} / {app['fw']}\n")
        lines.append(f"BaxBench: {comp['baxbench_cwes']} | ZAP: {comp['zap_cwes']}\n")
        if comp["both_found"]:
            lines.append(f"Confirmed: {comp['both_found']}\n")
        if comp["baxbench_only"]:
            lines.append(f"BaxBench only: {comp['baxbench_only']}\n")
        if comp["zap_only"]:
            lines.append(f"ZAP only: {comp['zap_only']}\n")
        lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines))
    print(f"\nReport saved to {report_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--skip-models", nargs="*", default=[], help="Skip configs containing these strings (e.g. deepseek ollama)")
    parser.add_argument("--offset", type=int, default=0, help="Skip the first N selected apps (for batch 2+)")
    parser.add_argument("--output-suffix", default="", help="Suffix for output files (e.g. '_batch2')")
    args = parser.parse_args()

    print(f"=== ZAP Active Scan Validation ===")
    skip_msg = f" (skipping: {', '.join(args.skip_models)})" if args.skip_models else ""
    print(f"Selecting {args.limit} apps{skip_msg}...")

    apps = select_apps(args.limit + args.offset, skip_models=args.skip_models)
    if args.offset > 0:
        print(f"  Skipping first {args.offset} (already scanned)")
        apps = apps[args.offset:args.offset + args.limit]
    else:
        apps = apps[:args.limit]
    print(f"Selected {len(apps)} apps")

    # Pull ZAP image
    print("Pulling ZAP Docker image...")
    client = docker.from_env()
    try:
        client.images.pull(ZAP_IMAGE)
        print("  ZAP image ready")
    except Exception as e:
        print(f"  Warning: {e}")

    all_results = []

    for i, app in enumerate(apps, 1):
        print(f"\n[{i}/{len(apps)}] {app['config']}/{app['scenario']}/{app['fw']}/{app['safety']}")
        print(f"  BaxBench CWEs: {app['cwes']}")

        sample_dir = pathlib.Path(app["sample_dir"])

        # Check if already scanned
        if args.resume and (sample_dir / "zap_active_report.json").exists():
            print("  Already scanned, skipping")
            # Load existing results
            zap_alerts = []
            data = json.load(open(sample_dir / "zap_active_report.json"))
            for site in data.get("site", []):
                for alert in site.get("alerts", []):
                    cwe = alert.get("cweid", "0")
                    zap_alerts.append({
                        "name": alert.get("name", ""),
                        "cweid": int(cwe) if cwe and cwe != "-1" else 0,
                        "riskcode": int(alert.get("riskcode", 0)),
                    })
            comparison = compare_results(app["cwes"], zap_alerts)
            all_results.append({"app": app, "zap_alerts": zap_alerts, "comparison": comparison})
            continue

        # Build and start app
        print("  Building and starting app...")
        container, port = build_and_start(app)

        if not container:
            print("  SKIP: failed to start")
            continue

        try:
            print(f"  App running on port {port}")
            print("  Running ZAP active scan (this takes 10-30 min)...")

            zap_alerts, exit_code = run_zap_active_scan(port, str(sample_dir))

            print(f"  ZAP scan complete (exit: {exit_code}, alerts: {len(zap_alerts)})")

            # Compare
            comparison = compare_results(app["cwes"], zap_alerts)
            print(f"  Comparison: both={comparison['both_found']} bax_only={comparison['baxbench_only']} zap_only={comparison['zap_only']}")
            print(f"  Agreement: {comparison['agreement']:.0f}%")

            all_results.append({
                "app": app,
                "zap_alerts": zap_alerts,
                "comparison": comparison,
            })

        finally:
            print("  Stopping app container...")
            try:
                container.remove(force=True)
            except:
                pass

    # Generate report
    print(f"\n{'='*60}")
    print("Generating validation report...")
    suffix = args.output_suffix
    if suffix:
        report_path = ROOT / "docs" / f"ZAP_ACTIVE_VALIDATION_REPORT{suffix}.md"
    else:
        report_path = REPORT_PATH
    generate_report(all_results, report_path)

    # Save raw results
    raw_path = ROOT / "docs" / f"zap_active_raw_results{suffix}.json"
    with open(raw_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"Raw results saved to {raw_path}")

    # Summary
    total_both = sum(len(r["comparison"]["both_found"]) for r in all_results)
    total_bax = sum(len(r["comparison"]["baxbench_cwes"]) for r in all_results)
    if total_bax > 0:
        print(f"\n=== FINAL: {total_both}/{total_bax} BaxBench findings validated ({total_both/total_bax*100:.1f}%) ===")
    else:
        print(f"\n=== FINAL: No BaxBench findings to validate (all apps failed to start?) ===")


if __name__ == "__main__":
    import sys
    # Force unbuffered output for nohup
    sys.stdout = open(sys.stdout.fileno(), mode='w', buffering=1)
    sys.stderr = open(sys.stderr.fileno(), mode='w', buffering=1)
    main()
