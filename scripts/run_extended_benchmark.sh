#!/usr/bin/env bash
# Full extended benchmark run: generate → test → evaluate.
# Supports checkpoint/resume — re-run the same command to pick up where you left off.
#
# Usage:
#   ./scripts/run_extended_benchmark.sh haiku-4.5-standard   # single config
#   ./scripts/run_extended_benchmark.sh all                   # all 10 configs
#   ./scripts/run_extended_benchmark.sh haiku-4.5-standard --reset  # clear checkpoint
set -euo pipefail

CONFIG="${1:-all}"
EXTRA_ARGS="${2:-}"
ENVS="Python-Flask,JavaScript-express,Go-Fiber"
RESULTS_BASE="results"

echo "=== BaxBench Extended Benchmark ==="
echo "Config: $CONFIG"
echo "Frameworks: $ENVS"
echo ""

# Step 1: Verify auth — either direct API key or proxy
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${BAXBENCH_PROXY_URL:-}" ]; then
    echo "No ANTHROPIC_API_KEY set. Using CLIProxyAPI proxy on localhost:8317."
    export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
    export BAXBENCH_PROXY_KEY="baxbench-local-key"
    # Quick check that proxy is reachable
    if ! curl -s "http://localhost:8317/v1/models" -H "Authorization: Bearer baxbench-local-key" > /dev/null 2>&1; then
        echo "ERROR: CLIProxyAPI not reachable on port 8317."
        echo "Start it with: cliproxyapi"
        exit 1
    fi
    echo "CLIProxyAPI proxy verified."
fi

# Step 2: Generate (with checkpoint/resume)
echo ""
echo "--- Phase 1: Generate ---"
pipenv run python scripts/rate_limit_queue.py --config "$CONFIG" $EXTRA_ARGS

# Step 3: Test all generated code
echo ""
echo "--- Phase 2: Test ---"
for dir in "$RESULTS_BASE"/*/; do
    config_name=$(basename "$dir")
    if [ "$CONFIG" != "all" ] && [ "$config_name" != "$CONFIG" ]; then
        continue
    fi
    # Determine the model from the config name
    model=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config_name':
        print(c['model'])
        break
")
    if [ -z "$model" ]; then
        echo "WARN: Unknown config $config_name, skipping test"
        continue
    fi
    echo "Testing: $config_name (model=$model)"
    pipenv run python src/main.py \
        --models "$model" \
        --mode test \
        --results_dir "$dir" \
        --envs $ENVS || echo "WARN: test phase had errors for $config_name"
done

# Step 4: Evaluate
echo ""
echo "--- Phase 3: Evaluate ---"
for dir in "$RESULTS_BASE"/*/; do
    config_name=$(basename "$dir")
    if [ "$CONFIG" != "all" ] && [ "$config_name" != "$CONFIG" ]; then
        continue
    fi
    model=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config_name':
        print(c['model'])
        break
")
    if [ -z "$model" ]; then
        continue
    fi
    echo "Evaluating: $config_name"
    pipenv run python src/main.py \
        --models "$model" \
        --mode evaluate \
        --results_dir "$dir" \
        --envs $ENVS || echo "WARN: evaluate phase had errors for $config_name"
done

# Step 5: Analysis
echo ""
echo "--- Phase 4: Analysis ---"
pipenv run python scripts/analyze_results.py --results-dir "$RESULTS_BASE"

echo ""
echo "=== Benchmark complete ==="
echo "Results in: $RESULTS_BASE/"
