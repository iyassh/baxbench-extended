#!/usr/bin/env python3
"""Run OWASP ZAP scans against all 10 manually pentested apps.

Builds each app in Docker, starts it, runs ZAP baseline scan,
and updates the corresponding manual_results.json with real ZAP alerts.
"""
import json
import io
import pathlib
import socket
import tarfile
import time
import uuid

import docker

ROOT = pathlib.Path(__file__).parent.parent

# The 10 apps to scan
APPS = [
    {
        "config": "haiku-4.5-standard",
        "model": "claude-haiku-4-5-20251001",
        "scenario": "Login",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "haiku-4.5-standard",
        "model": "claude-haiku-4-5-20251001",
        "scenario": "Forum",
        "framework": "JavaScript-express",
        "lang": "javascript",
    },
    {
        "config": "opus-4.1-thinking",
        "model": "claude-opus-4-1-20250805",
        "scenario": "MultiUserNotes",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "sonnet-4-standard",
        "model": "claude-sonnet-4-20250514",
        "scenario": "LinkPreview",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "sonnet-4.6-standard",
        "model": "claude-sonnet-4-6",
        "scenario": "AdminPanel",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "opus-4-standard",
        "model": "claude-opus-4-20250514",
        "scenario": "XMLImporter",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "sonnet-4.5-standard",
        "model": "claude-sonnet-4-5-20250929",
        "scenario": "Checkout",
        "framework": "JavaScript-express",
        "lang": "javascript",
    },
    {
        "config": "haiku-4.5-standard",
        "model": "claude-haiku-4-5-20251001",
        "scenario": "PasswordReset",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "opus-4.6-standard",
        "model": "claude-opus-4-6",
        "scenario": "SecretStorage",
        "framework": "Python-Flask",
        "lang": "python",
    },
    {
        "config": "sonnet-4-thinking",
        "model": "claude-sonnet-4-20250514",
        "scenario": "Calculator",
        "framework": "Go-Fiber",
        "lang": "go",
    },
]

# Dockerfiles per framework
DOCKERFILES = {
    "Python-Flask": """
FROM nikolaik/python-nodejs:python3.12-nodejs22-bullseye
RUN mkdir -p /app
WORKDIR /app
COPY requirements.txt requirements.txt
RUN python3 -m pip install -r requirements.txt
ENV APP_SECRET=supers3cret
COPY / /app/
ENTRYPOINT python3 app.py
""",
    "JavaScript-express": """
FROM node:22-bullseye
RUN mkdir -p /app
WORKDIR /app
COPY package.json package.json
RUN npm install
COPY / /app/
ENTRYPOINT ["node", "app.js"]
""",
    "Go-Fiber": """
FROM golang:1.23-bullseye
RUN mkdir -p /app
WORKDIR /app
COPY / /app/
RUN if [ -f go.mod ]; then go mod download; fi
RUN if [ ! -f go.mod ]; then go mod init app && go mod tidy; fi
RUN go build -o server .
ENTRYPOINT ["./server"]
""",
}

MANIFEST_FILES = {
    "Python-Flask": {
        "requirements.txt": """itsdangerous==2.2.0
blinker==1.9.0
click==8.1.7
Flask==3.1.0
Jinja2==3.1.4
MarkupSafe==3.0.2
Werkzeug==3.1.3
passlib==1.7.4
fpdf==1.7.2
pyjwt==2.10.1
"""
    },
    "JavaScript-express": {
        "package.json": json.dumps({
            "name": "app",
            "version": "1.0.0",
            "dependencies": {
                "express": "^4.18.2",
                "better-sqlite3": "^9.4.3",
                "dotenv": "^16.3.1",
                "jsonwebtoken": "^9.0.2",
                "bcryptjs": "^2.4.3",
                "uuid": "^9.0.0",
                "cors": "^2.8.5"
            }
        }, indent=2)
    },
    "Go-Fiber": {},  # Go apps have their own go.mod/go.sum
}


def get_free_port():
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def get_sample_dir(app):
    return ROOT / "results" / app["config"] / app["model"] / app["scenario"] / app["framework"] / "temp0.2-openapi-none" / "sample0"


def build_image(client, app, code_dir):
    """Build Docker image from app code."""
    framework = app["framework"]
    dockerfile = DOCKERFILES[framework]
    manifests = MANIFEST_FILES.get(framework, {})

    tar_stream = io.BytesIO()
    with tarfile.open(fileobj=tar_stream, mode="w") as tar:
        def add_file(name, content):
            data = io.BytesIO(content.encode())
            info = tarfile.TarInfo(name=name)
            info.size = len(data.getvalue())
            tar.addfile(info, fileobj=data)

        add_file("Dockerfile", dockerfile)
        for f in code_dir.iterdir():
            if f.is_file() and not f.name.startswith("."):
                add_file(f.name, f.read_text())
        for name, content in manifests.items():
            if not (code_dir / name).exists():
                add_file(name, content)

    tar_stream.seek(0)
    tag = f"baxbench-zap-{app['scenario'].lower()}"
    image, _ = client.images.build(
        fileobj=tar_stream,
        custom_context=True,
        tag=tag,
        rm=True,
        timeout=300,
        forcerm=True,
    )
    return image.id


def run_zap_scan(client, port, results_dir):
    """Run ZAP baseline scan and return alerts."""
    import subprocess

    zap_report_path = results_dir / "zap_report.json"
    # Remove old report if exists
    if zap_report_path.exists():
        zap_report_path.unlink()

    try:
        # Run ZAP via subprocess for better output handling
        result = subprocess.run(
            [
                "docker", "run", "--rm", "--user", "root",
                "--add-host=host.docker.internal:host-gateway",
                "-v", f"{results_dir.resolve()}:/zap/wrk:rw",
                "ghcr.io/zaproxy/zaproxy:stable",
                "zap-baseline.py",
                "-t", f"http://host.docker.internal:{port}/",
                "-J", "zap_report.json",
                "-I", "-m", "1",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        print(f"    ZAP exit code: {result.returncode}")

        # Parse results
        if zap_report_path.exists():
            with open(zap_report_path) as f:
                zap_data = json.load(f)
            alerts = []
            for site in zap_data.get("site", []):
                for alert in site.get("alerts", []):
                    alerts.append({
                        "name": alert.get("name", ""),
                        "riskdesc": alert.get("riskdesc", ""),
                        "cweid": str(alert.get("cweid", "")),
                        "count": str(alert.get("count", "")),
                        "solution": alert.get("solution", "")[:200],
                    })
            return alerts
        else:
            print("    No ZAP report file generated")
            if result.stderr:
                print(f"    ZAP stderr: {result.stderr[-200:]}")
            return None

    except subprocess.TimeoutExpired:
        print("    ZAP timed out after 5 min")
        return None
    except Exception as e:
        print(f"    ZAP error: {e}")
        return None


def update_manual_results(sample_dir, zap_alerts):
    """Update manual_results.json with real ZAP alerts."""
    mr_path = sample_dir / "manual_results.json"
    if mr_path.exists():
        with open(mr_path) as f:
            data = json.load(f)
        data["zap_alerts"] = zap_alerts
        # Update session log
        data.setdefault("session_log", []).append({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "action": "zap_real_scan",
            "detail": f"Real ZAP scan completed — {len(zap_alerts)} alerts",
        })
        with open(mr_path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"    Updated {mr_path.name} with {len(zap_alerts)} real ZAP alerts")
    else:
        print(f"    WARNING: {mr_path} not found")


def main():
    client = docker.from_env()

    # Verify ZAP image is available
    try:
        client.images.get("ghcr.io/zaproxy/zaproxy:stable")
    except docker.errors.ImageNotFound:
        print("ZAP image not found. Pull it first:")
        print("  docker pull ghcr.io/zaproxy/zaproxy:stable")
        return

    for i, app in enumerate(APPS, 1):
        sample_dir = get_sample_dir(app)
        code_dir = sample_dir / "code"

        print(f"\n[{i}/10] {app['config']} / {app['scenario']} / {app['framework']}")

        if not code_dir.exists():
            print(f"  SKIP: No code at {code_dir}")
            continue

        # Build
        print("  Building Docker image...")
        try:
            image_id = build_image(client, app, code_dir)
        except Exception as e:
            print(f"  BUILD FAILED: {e}")
            continue

        # Start container
        port = get_free_port()
        print(f"  Starting container on port {port}...")
        container = None
        try:
            # Flask=5000, Express=3000, Go-Fiber=5000
            app_port = 3000 if app["framework"] == "JavaScript-express" else 5000
            container = client.containers.run(
                image_id,
                name=f"baxbench-zap-{uuid.uuid4().hex[:8]}",
                detach=True,
                ports={f"{app_port}/tcp": port},
            )

            # Wait for app to be ready
            ready = False
            for _ in range(30):
                try:
                    import requests
                    r = requests.get(f"http://localhost:{port}/", timeout=2)
                    print(f"  App ready (status {r.status_code})")
                    ready = True
                    break
                except Exception:
                    time.sleep(2)

            if not ready:
                print("  App did not start in 60s, running ZAP anyway...")

            # Run ZAP
            print("  Running ZAP baseline scan...")
            alerts = run_zap_scan(client, port, sample_dir)

            if alerts is not None:
                print(f"  ZAP found {len(alerts)} alerts:")
                for a in alerts[:5]:
                    print(f"    - {a['riskdesc']}: {a['name']}")
                if len(alerts) > 5:
                    print(f"    ... and {len(alerts)-5} more")

                update_manual_results(sample_dir, alerts)
            else:
                print("  ZAP scan returned no results")

        except Exception as e:
            print(f"  ERROR: {e}")

        finally:
            if container:
                try:
                    container.remove(force=True)
                    print("  Container removed")
                except Exception:
                    pass

    print("\n Done! All ZAP scans complete.")


if __name__ == "__main__":
    main()
