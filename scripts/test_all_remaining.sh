#!/usr/bin/env bash
# Test all configs that have generated code but no test results yet
set -uo pipefail
cd /Users/yassh/baxbench

export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
export BAXBENCH_PROXY_KEY="baxbench-local-key"

LOG="test_all.log"
ENVS=("Python-Flask" "JavaScript-express" "Go-Fiber")
RESULTS_BASE="results"

# Configs that need testing (already have code from Batch 1 testing)
TEST_CONFIGS=(
    "sonnet-4.5-thinking"
    "sonnet-4-standard"
    "sonnet-4-thinking"
    "opus-4-standard"
)

echo "=== Testing started at $(date) ===" | tee -a "$LOG"

for CONFIG in "${TEST_CONFIGS[@]}"; do
    MODEL=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$CONFIG':
        print(c['model'])
        break
")
    if [ -z "$MODEL" ]; then
        echo "ERROR: Unknown config $CONFIG" | tee -a "$LOG"
        continue
    fi

    for SP in none generic specific; do
        echo "[$CONFIG] Testing safety=$SP at $(date)" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$MODEL" \
            --mode test \
            --safety_prompt "$SP" \
            --results_dir "$RESULTS_BASE/$CONFIG" \
            --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: test error $CONFIG/$SP" | tee -a "$LOG"
    done

    docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"
    echo "[$CONFIG] Done at $(date)" | tee -a "$LOG"
done

# Now test the remaining configs (opus-4-thinking, opus-4.1-standard, opus-4.1-thinking)
# These should have finished backfilling by now
for CONFIG in opus-4-thinking opus-4.1-standard opus-4.1-thinking; do
    MODEL=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$CONFIG':
        print(c['model'])
        break
")
    if [ -z "$MODEL" ]; then
        echo "ERROR: Unknown config $CONFIG" | tee -a "$LOG"
        continue
    fi

    for SP in none generic specific; do
        echo "[$CONFIG] Testing safety=$SP at $(date)" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$MODEL" \
            --mode test \
            --safety_prompt "$SP" \
            --results_dir "$RESULTS_BASE/$CONFIG" \
            --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: test error $CONFIG/$SP" | tee -a "$LOG"
    done

    docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"
    echo "[$CONFIG] Done at $(date)" | tee -a "$LOG"
done

# Evaluate ALL configs
echo "=== Evaluating ALL configs at $(date) ===" | tee -a "$LOG"
for CONFIG in sonnet-4.5-standard opus-4.6-standard opus-4.6-thinking sonnet-4.6-standard sonnet-4.6-thinking sonnet-4.5-thinking sonnet-4-standard sonnet-4-thinking opus-4-standard opus-4-thinking opus-4.1-standard opus-4.1-thinking; do
    MODEL=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$CONFIG':
        print(c['model'])
        break
")
    [ -z "$MODEL" ] && continue

    for SP in none generic specific; do
        echo "[$CONFIG] Evaluating safety=$SP" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$MODEL" \
            --mode evaluate \
            --safety_prompt "$SP" \
            --results_dir "$RESULTS_BASE/$CONFIG" \
            --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || true
    done
done

# Reload dashboard
echo "=== Reloading dashboard DB ===" | tee -a "$LOG"
pipenv run python scripts/load_results_db.py 2>&1 | tee -a "$LOG"

echo "=== ALL DONE at $(date) ===" | tee -a "$LOG"
