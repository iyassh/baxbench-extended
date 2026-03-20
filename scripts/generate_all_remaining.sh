#!/usr/bin/env bash
# Generate code for ALL remaining configs first, then test+evaluate all at the end.
# This maximizes API usage upfront, testing is local Docker afterwards.
set -uo pipefail

cd /Users/yassh/baxbench

export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
export BAXBENCH_PROXY_KEY="baxbench-local-key"

LOG="generate_all.log"

# Batch 2 configs to generate
GENERATE_CONFIGS=(
    "sonnet-4-standard"
    "sonnet-4-thinking"
    "opus-4-standard"
    "opus-4-thinking"
    "opus-4.1-standard"
    "opus-4.1-thinking"
)

# ALL configs that need testing (Batch 1 remaining + Batch 2)
TEST_CONFIGS=(
    "sonnet-4.5-thinking"
    "sonnet-4-standard"
    "sonnet-4-thinking"
    "opus-4-standard"
    "opus-4-thinking"
    "opus-4.1-standard"
    "opus-4.1-thinking"
)

# ALL configs that need evaluation
EVAL_CONFIGS=(
    "sonnet-4.5-standard"
    "opus-4.6-standard"
    "opus-4.6-thinking"
    "sonnet-4.6-standard"
    "sonnet-4.6-thinking"
    "sonnet-4.5-thinking"
    "sonnet-4-standard"
    "sonnet-4-thinking"
    "opus-4-standard"
    "opus-4-thinking"
    "opus-4.1-standard"
    "opus-4.1-thinking"
)

ENVS=("Python-Flask" "JavaScript-express" "Go-Fiber")
RESULTS_BASE="results"

echo "=== PHASE 1: Generate ALL code ===" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"

for CONFIG in "${GENERATE_CONFIGS[@]}"; do
    echo "[$CONFIG] Generating at $(date)" | tee -a "$LOG"
    pipenv run python scripts/rate_limit_queue.py --config "$CONFIG" 2>&1 | tee -a "$LOG"
    echo "[$CONFIG] Generation done at $(date)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "=== PHASE 2: Test ALL configs ===" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"

for CONFIG in "${TEST_CONFIGS[@]}"; do
    MODEL=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$CONFIG':
        print(c['model'])
        break
")
    if [ -z "$MODEL" ]; then
        echo "ERROR: Unknown config $CONFIG, skipping" | tee -a "$LOG"
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

    # Prune Docker between configs
    docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "=== PHASE 3: Evaluate ALL configs ===" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"

for CONFIG in "${EVAL_CONFIGS[@]}"; do
    MODEL=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$CONFIG':
        print(c['model'])
        break
")
    if [ -z "$MODEL" ]; then
        echo "ERROR: Unknown config $CONFIG, skipping" | tee -a "$LOG"
        continue
    fi

    for SP in none generic specific; do
        echo "[$CONFIG] Evaluating safety=$SP" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$MODEL" \
            --mode evaluate \
            --safety_prompt "$SP" \
            --results_dir "$RESULTS_BASE/$CONFIG" \
            --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: eval error $CONFIG/$SP" | tee -a "$LOG"
    done
done

# Reload dashboard DB
echo "=== Reloading dashboard database ===" | tee -a "$LOG"
pipenv run python scripts/load_results_db.py 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== ALL DONE at $(date) ===" | tee -a "$LOG"
