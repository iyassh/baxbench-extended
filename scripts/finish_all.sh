#!/usr/bin/env bash
# Final cleanup script — backfill missing, test remaining, evaluate all, reload DB
set -uo pipefail
cd /Users/yassh/baxbench

export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
export BAXBENCH_PROXY_KEY="baxbench-local-key"

LOG="finish_all.log"
SCENARIOS=(Calculator ClickCount Compiler CreditCardService FileSearch Forum FrameExtract ImageConverter ImageTransfer Logger Login Monitor PDFCat PDFToText ProductCatalog ProfileCollection Recipes RecommendationService RegexSearch SecretStorage ShopOverview ShoppingCartService SongDownloader Unsubscribe UptimeService UserCreation Wiki ZipToTxt)
ENVS_ARR=(Python-Flask JavaScript-express Go-Fiber)
RESULTS_BASE="results"

echo "=== finish_all.sh started at $(date) ===" | tee -a "$LOG"

# ── PHASE 1: Backfill missing generations ─────────────────────────────────────
echo "" | tee -a "$LOG"
echo "=== PHASE 1: Backfill missing code ===" | tee -a "$LOG"

for config in opus-4-thinking opus-4.1-thinking; do
    model=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config':
        print(c['model'])
        break")

    for scenario in "${SCENARIOS[@]}"; do
        for env in "${ENVS_ARR[@]}"; do
            for sp in none generic specific; do
                d="$RESULTS_BASE/$config/$model/$scenario/$env/temp0.2-openapi-$sp/sample0/code"
                if [ ! -d "$d" ] || [ -z "$(ls -A "$d" 2>/dev/null)" ]; then
                    echo "[$config] Generating $scenario/$env/$sp" | tee -a "$LOG"
                    pipenv run python src/main.py \
                        --models "$model" \
                        --mode generate \
                        --scenarios "$scenario" \
                        --envs "$env" \
                        --safety_prompt "$sp" \
                        --n_samples 1 \
                        --temperature 0.2 \
                        --results_dir "$RESULTS_BASE/$config" 2>&1 | tail -1 | tee -a "$LOG"
                fi
            done
        done
    done
    echo "[$config] Backfill done" | tee -a "$LOG"
done

# ── PHASE 2: Test remaining ────────────────────────────────────────────────────
echo "" | tee -a "$LOG"
echo "=== PHASE 2: Test remaining configs ===" | tee -a "$LOG"

# haiku: only missing 'specific' safety prompt
echo "[haiku-4.5-standard] Testing specific safety prompt" | tee -a "$LOG"
pipenv run python src/main.py \
    --models claude-haiku-4-5-20251001 \
    --mode test \
    --safety_prompt specific \
    --results_dir "$RESULTS_BASE/haiku-4.5-standard" \
    --envs "${ENVS_ARR[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: haiku specific test error" | tee -a "$LOG"

docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"

# opus-4-thinking and opus-4.1-thinking: all 3 safety prompts
for config in opus-4-thinking opus-4.1-thinking; do
    model=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config':
        print(c['model'])
        break")

    for sp in none generic specific; do
        echo "[$config] Testing safety=$sp at $(date)" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$model" \
            --mode test \
            --safety_prompt "$sp" \
            --results_dir "$RESULTS_BASE/$config" \
            --envs "${ENVS_ARR[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: $config/$sp test error" | tee -a "$LOG"
    done

    docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"
    echo "[$config] Testing done" | tee -a "$LOG"
done

# ── PHASE 3: Evaluate ALL configs ─────────────────────────────────────────────
echo "" | tee -a "$LOG"
echo "=== PHASE 3: Evaluate ALL configs ===" | tee -a "$LOG"

ALL_CONFIGS=(
    haiku-4.5-standard
    sonnet-4.5-standard sonnet-4.5-thinking
    sonnet-4-standard sonnet-4-thinking
    sonnet-4.6-standard sonnet-4.6-thinking
    opus-4-standard opus-4-thinking
    opus-4.1-standard opus-4.1-thinking
    opus-4.6-standard opus-4.6-thinking
)

for config in "${ALL_CONFIGS[@]}"; do
    model=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config':
        print(c['model'])
        break")
    [ -z "$model" ] && echo "WARN: unknown config $config, skipping" | tee -a "$LOG" && continue

    for sp in none generic specific; do
        echo "[$config] Evaluating safety=$sp" | tee -a "$LOG"
        pipenv run python src/main.py \
            --models "$model" \
            --mode evaluate \
            --safety_prompt "$sp" \
            --results_dir "$RESULTS_BASE/$config" \
            --envs "${ENVS_ARR[@]}" 2>&1 | tee -a "$LOG" || echo "WARN: $config/$sp eval error" | tee -a "$LOG"
    done
    echo "[$config] Evaluation done" | tee -a "$LOG"
done

# ── PHASE 4: Reload dashboard ──────────────────────────────────────────────────
echo "" | tee -a "$LOG"
echo "=== PHASE 4: Reload dashboard DB ===" | tee -a "$LOG"
pipenv run python scripts/load_results_db.py 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== ALL DONE at $(date) ===" | tee -a "$LOG"
