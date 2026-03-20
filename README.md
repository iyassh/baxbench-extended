# BaxBench Security Benchmark Dashboard

**COMP 4210 — Ethical Hacking | Group 8**

A security benchmark analysis of 13 Claude model configurations using the [BaxBench](https://baxbench.com) framework. Tests code generation across 28 security-critical scenarios, 3 web frameworks, and 3 safety prompt levels.

## Key Findings

- **3,276 total test results** across 13 model configurations
- **14 unique CWEs** detected (out of 23 monitored)
- **Best model:** opus-4.1-thinking at 14.3% sec_pass@1
- **Safety prompts are critical:** Specific safety prompts improve security by 22.6 percentage points on average
- **Without safety prompts, sec_pass@1 is essentially 0%** across all models
- **Thinking mode has mixed results:** Improves opus-4.1 (+4.8pp) but hurts sonnet-4.5 (-4.4pp)
- **CWE-693 (Missing Security Headers)** accounts for 56% of all vulnerabilities

## Models Tested

| Model | Variants | sec_pass@1 (best) |
|-------|----------|-------------------|
| Claude Opus 4.6 | standard, thinking | 7.9% |
| Claude Opus 4.1 | standard, thinking | 14.3% |
| Claude Opus 4 | standard, thinking | 6.0% |
| Claude Sonnet 4.6 | standard, thinking | 11.5% |
| Claude Sonnet 4.5 | standard, thinking | 5.2% |
| Claude Sonnet 4 | standard, thinking | 6.7% |
| Claude Haiku 4.5 | standard | 10.7% |

## Project Structure

```
baxbench/
  dashboard/          # Next.js security dashboard
  results/            # Benchmark results (13 configs x 252 tests each)
  scripts/            # Benchmark runner scripts
  src/                # BaxBench source (scenarios, tests, CWE definitions)
  docs/plans/         # Design documents
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.12
- Docker (for running benchmarks only)
- pipenv

### Run the Dashboard

```bash
# Install dependencies
cd dashboard
npm install

# Start the dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

The dashboard reads from `dashboard/baxbench.db` (SQLite, included in repo). No additional setup needed.

### Dashboard Pages

- **Overview** — Key insights, model ranking chart, vulnerability heatmap, safety prompt impact
- **Models** — Filterable model cards with detail panels and radar charts
- **Vulnerabilities** — CWE treemap and expandable analysis
- **Compare** — Side-by-side: safety prompts, thinking vs standard, frameworks, model families

### Reload the Database (after new benchmark runs)

```bash
pipenv run python scripts/load_results_db.py
```

### Run New Benchmarks

Requires the CLIProxyAPI running on port 8317 and Docker.

```bash
# Generate code for a model
pipenv run python scripts/rate_limit_queue.py --config sonnet-4.6-standard

# Test generated code (run once per safety prompt)
pipenv run python src/main.py \
  --models claude-sonnet-4-6 \
  --mode test \
  --safety_prompt none \
  --results_dir results/sonnet-4.6-standard \
  --envs Python-Flask JavaScript-express Go-Fiber

# Repeat for --safety_prompt generic and specific
```

## Tech Stack

**Dashboard:** Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, Recharts, Framer Motion, better-sqlite3

**Benchmark:** Python 3.12, BaxBench framework, Docker, Claude API

## Based On

This project extends the [BaxBench](https://baxbench.com) benchmark framework ([paper](https://arxiv.org/abs/2502.11844)) for security test scenarios and evaluation.

## License

MIT
