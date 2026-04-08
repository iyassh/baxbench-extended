# ZAP Active Scan Validation — Design Document

## Goal

Run OWASP ZAP **active scans** (not passive) against 50 AI-generated apps to validate CodeStrike automated results. Prove that when CodeStrike says "SQL injection found" or "XSS found," an industry-standard scanner agrees.

## Why This Matters

The previous ZAP scan was **passive only** — it just inspected HTTP response headers. That's why ZAP only found CWE-693/497/524 (header issues) and couldn't validate CodeStrike's injection/auth findings.

An active scan sends actual attack payloads (SQLi strings, XSS vectors, command injection) — exactly what CodeStrike does. This creates a true apples-to-apples comparison.

## What ZAP Active Scanner Detects

| CWE | Vulnerability | ZAP Plugin IDs | CodeStrike Also Tests |
|---|---|---|---|
| CWE-89 | SQL Injection | 40018-40027 | Yes (25 vectors) |
| CWE-79 | XSS (Reflected, Stored, DOM) | 40012, 40014, 40026 | Yes (25 vectors) |
| CWE-78 | OS Command Injection | 90020 | Yes (12+5 vectors) |
| CWE-22 | Path Traversal | 6 | Yes (22+5 vectors) |
| CWE-611 | XXE | 90023 | Yes (scenario-specific) |
| CWE-352 | CSRF | 10202, 20012 | Yes |
| CWE-94 | Code Injection | 90019 | Yes |
| CWE-693 | Missing Headers | 10020, 10021, 10038 | Yes |
| CWE-209 | Error Info Leakage | various | Yes |
| CWE-918 | SSRF | 40046 | Yes (10 vectors) |

**9 out of our 16 detected CWE types are directly validatable by ZAP active scan.**

## Selected Apps (50)

Strategically selected to cover:
- 15 models (all Claude + DeepSeek + Llama)
- 18 scenarios
- 16 CWE types
- All apps have real CWEs (not just headers)
- All apps have functional_pass=True (code works, can be scanned)

## Architecture

```
For each of 50 apps:
  1. Build Docker image from generated code
  2. Start container on random port
  3. Wait for health check
  4. Run ZAP active scan (Docker container)
  5. Parse ZAP JSON report
  6. Compare ZAP findings with CodeStrike test_results.json
  7. Record: TP (both found), FP (ZAP found, CodeStrike didn't), FN (CodeStrike found, ZAP didn't)
  8. Stop both containers
  9. Save results to zap_active_results.json
```

## Key Configuration

ZAP will run with **maximum detection settings**:
- `zap-api-scan.py -a` (active scanning enabled)
- `defaultStrength: insane` (maximum attack variants)
- `defaultThreshold: low` (most sensitive detection)

## Expected Output

1. `results/**/zap_active_report.json` — per-app ZAP findings (50 files)
2. `docs/ZAP_ACTIVE_VALIDATION_REPORT.md` — comparison report
3. Agreement metrics: precision, recall, F1 for CodeStrike vs ZAP

## Timeline

- ~20 min per app × 50 apps = ~17 hours
- Runs fully automated in background
- Can extend to 100+ apps if time permits
