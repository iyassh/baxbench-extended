#!/usr/bin/env bash
# Full extended benchmark run: generate → test → evaluate.
# Usage: ./scripts/run_extended_benchmark.sh [config_name|all]
set -euo pipefail

CONFIG="${1:-all}"
ENVS="Python-Flask,JavaScript-Express,Go-Fiber"
RESULTS_BASE="results"

echo "=== BaxBench Extended Benchmark ==="
echo "Config: $CONFIG"
echo "Frameworks: $ENVS"
echo ""

# Step 1: Verify auth
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY not set."
    echo "Run: claude setup-token"
    echo "Then: export ANTHROPIC_API_KEY='<token>'"
    exit 1
fi

# Step 2: Generate
echo "--- Phase 1: Generate ---"
pipenv run python scripts/rate_limit_queue.py --config "$CONFIG"

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
