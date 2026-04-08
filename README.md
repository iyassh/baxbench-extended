# CodeStrike Security Benchmark

**COMP 4210 -- Ethical Hacking | Group 8**

A security benchmark analysis of AI-generated code using the [BaxBench](https://arxiv.org/abs/2502.11844) framework. Tests 15 model configurations across 28 security-critical scenarios, 3 web frameworks, and 3 safety prompt levels. Includes manual pentesting validation and OWASP ZAP comparison.

## Key Findings

- **3,276+ test results** across 15 model configurations (Claude, DeepSeek, LLaMA)
- **14 unique CWEs** detected out of 23 monitored
- **Best model:** opus-4.1-thinking at 14.3% sec_pass@1
- **Safety prompts matter:** Specific safety prompts improve security by +22.6pp on average
- **Manual pentesting** found 41 vulnerabilities across 10 apps -- CodeStrike caught 11 (100% precision, 27% recall)
- **ZAP comparison:** Only 14.3% agreement with CodeStrike across all scan modes
- **CWE-693 (Missing Security Headers)** accounts for 56% of all vulnerabilities

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Overview** | Key insights, model ranking, vulnerability heatmap, safety prompt impact |
| **Models** | Filterable model cards with radar charts and detail panels |
| **Vulnerabilities** | CWE treemap and expandable vulnerability analysis |
| **Compare** | Side-by-side: safety prompts, thinking vs standard, frameworks, model families |
| **Pentest** | Manual pentesting results, 3-way comparison (CodeStrike vs ZAP vs Manual) |
| **Results** | Browse individual test results with prompts, generated code, and test logs |

---

## Local Setup (for Group Members)

### Prerequisites

- **Git**
- **Node.js 18+** (check: `node -v`)
- **npm** (comes with Node.js)
- **Python 3.10+** (only needed for running benchmarks or pentest tools)
- **Docker Desktop** (only needed for running benchmarks or ZAP scans)

### Step 1: Clone the Repository

```bash
git clone https://github.com/iyassh/baxbench-extended.git
cd baxbench-extended
```

### Step 2: Install Dashboard Dependencies

```bash
cd dashboard
npm install
```

### Step 3: Run the Dashboard

```bash
npm run dev
```

Open **http://localhost:3000** in your browser. The dashboard reads from pre-built JSON data files -- no database setup or API keys needed.

That's it! You should see all pages: Overview, Models, Vulnerabilities, Compare, Pentest, and Results.

---

## Rebuilding Data Files (Optional)

If the SQLite database (`dashboard/baxbench.db`) is updated with new benchmark results, regenerate the JSON data files:

```bash
cd dashboard

# Export main dashboard data (configs, results, CWEs, heatmap, etc.)
node scripts/export-data.js

# Export per-result details (prompts, generated code, test logs)
node scripts/export-details.js
```

The first script writes to `dashboard/data/*.json`, the second to `dashboard/public/details/*.json`.

### Updating the Database

After running new benchmarks, load results into SQLite:

```bash
# From project root
pipenv run python scripts/load_results_db.py

# Then re-export (see above)
```

---

## Running Benchmarks (Optional)

Requires: Docker, Python 3.10+, Anthropic API key (for Claude) or Ollama (for free models).

### Install Python Dependencies

```bash
# Using pipenv (recommended)
pip install pipenv
pipenv install

# Or directly with pip
pip install requests docker openai anthropic tabulate simple-parsing tqdm termcolor
```

### Set API Key (Claude models only)

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

### Generate & Test

```bash
# Generate code for a single scenario (quick test)
pipenv run python src/main.py \
  --models claude-sonnet-4-6 \
  --mode generate \
  --safety_prompt none \
  --scenarios Calculator \
  --envs Python-Flask \
  --results_dir results/sonnet-4.6-standard \
  --n_samples 1

# Test generated code
pipenv run python src/main.py \
  --models claude-sonnet-4-6 \
  --mode test \
  --safety_prompt none \
  --scenarios Calculator \
  --envs Python-Flask \
  --results_dir results/sonnet-4.6-standard
```

### Using Ollama (Free Models)

```bash
# Install and start Ollama
brew install ollama   # macOS
ollama serve &

# Pull a model
ollama pull deepseek-coder:6.7b

# Run benchmark with --ollama flag
pipenv run python src/main.py \
  --models deepseek-coder:6.7b \
  --mode generate \
  --ollama \
  --safety_prompt none \
  --scenarios Calculator \
  --envs Python-Flask \
  --results_dir results/deepseek-test
```

---

## Running Manual Pentest Tools (Optional)

The pentest module provides an interactive CLI for manual security testing of generated apps.

```bash
# Show the OWASP WSTG checklist for a scenario
pipenv run python src/main.py \
  --mode pentest \
  --show-checklist \
  --models claude-haiku-4-5-20251001 \
  --scenarios Login \
  --envs Python-Flask \
  --results_dir results/haiku-4.5-standard \
  --only_samples 0

# Interactive pentest session (launches Docker container + ZAP)
pipenv run python src/main.py \
  --mode pentest \
  --interactive \
  --models claude-haiku-4-5-20251001 \
  --scenarios Login \
  --envs Python-Flask \
  --results_dir results/haiku-4.5-standard \
  --only_samples 0
```

Results are saved as `manual_results.json` alongside the app's test results.

---

## Project Structure

```
baxbench-extended/
  dashboard/                    # Next.js web dashboard
    app/                        #   Pages (overview, models, pentest, results, etc.)
    components/                 #   React components
    data/                       #   Exported JSON data files
    public/details/             #   Per-result prompt/code/log files
    scripts/                    #   Data export scripts
    baxbench.db                 #   SQLite database (source of truth)
  results/                      # Benchmark results (15 configs)
    {config}/                   #   e.g., haiku-4.5-standard/
      {model}/{scenario}/{fw}/  #     Contains code/, test_results.json, manual_results.json
  src/                          # CodeStrike benchmark source
    main.py                     #   CLI entry point (generate/test/pentest modes)
    pentest.py                  #   Manual pentesting module
    checklists.py               #   OWASP WSTG checklist items
    pentest_report.py           #   4-way comparison report generator
    cwes.py                     #   CWE definitions (39 total)
  scripts/                      # Automation scripts
  docs/                         # Documentation and reports
    PRESENTATION_GUIDE.md       #   30-minute presentation guide
    MANUAL_PENTEST_REPORT.md    #   Pentest comparison report
    MANUAL_PENTEST_METHODOLOGY.md
```

## Tech Stack

**Dashboard:** Next.js 16, React 19, Tailwind CSS v4, Recharts, Framer Motion, better-sqlite3

**Benchmark:** Python 3.12, BaxBench framework, Docker, Claude API, Ollama

**Security Testing:** OWASP ZAP (Docker), Manual pentesting CLI, SAST regex patterns

## License

MIT
