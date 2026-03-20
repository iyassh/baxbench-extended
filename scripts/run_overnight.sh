#!/usr/bin/env bash
# Overnight benchmark runner — runs multiple configs sequentially.
# Each config: generate → test → evaluate
# Checkpoint/resume safe — re-run if interrupted.
set -uo pipefail

export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
export BAXBENCH_PROXY_KEY="baxbench-local-key"

CONFIGS=(
    "opus-4.6-standard"
    "opus-4.6-thinking"
    "sonnet-4.6-standard"
    "sonnet-4.6-thinking"
    "sonnet-4.5-thinking"
)

ENVS=("Python-Flask" "JavaScript-express" "Go-Fiber")
RESULTS_BASE="results"
LOG="overnight_benchmark.log"

echo "=== Overnight Benchmark Run ===" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "Configs: ${CONFIGS[*]}" | tee -a "$LOG"
echo "" | tee -a "$LOG"

for CONFIG in "${CONFIGS[@]}"; do
    echo "========================================" | tee -a "$LOG"
    echo "[$CONFIG] Starting at $(date)" | tee -a "$LOG"
    echo "========================================" | tee -a "$LOG"

    # Get model ID
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

    # Phase 1: Generate
    echo "[$CONFIG] Phase 1: Generate" | tee -a "$LOG"
    pipenv run python scripts/rate_limit_queue.py --config "$CONFIG" 2>&1 | tee -a "$LOG"

    # Phase 2: Test (must run once per safety prompt — BaxBench only tests one at a time)
    for SP in none generic specific; do
        echo "[$CONFIG] Phase 2: Test (safety=$SP)" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$MODEL" \
            --mode test \
            --safety_prompt "$SP" \
            --results_dir "$RESULTS_BASE/$CONFIG" \
            --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: test had errors for $CONFIG/$SP" | tee -a "$LOG"
    done

    # Phase 3: Evaluate (must also run per safety prompt)
    for SP in none generic specific; do
        echo "[$CONFIG] Phase 3: Evaluate (safety=$SP)" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$MODEL" \
            --mode evaluate \
            --safety_prompt "$SP" \
            --results_dir "$RESULTS_BASE/$CONFIG" \
            --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: evaluate had errors for $CONFIG/$SP" | tee -a "$LOG"
    done

    echo "[$CONFIG] Done at $(date)" | tee -a "$LOG"
    echo "" | tee -a "$LOG"
done

# Reload dashboard DB
echo "=== Reloading dashboard database ===" | tee -a "$LOG"
pipenv run python scripts/load_results_db.py 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== Batch 1 complete at $(date) ===" | tee -a "$LOG"

# Chain to batch 2 (Sonnet 4, Opus 4, Opus 4.5)
echo "=== Starting Batch 2 ===" | tee -a "$LOG"
exec ./scripts/run_batch2.sh
