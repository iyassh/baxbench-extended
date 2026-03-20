#!/usr/bin/env bash
# Backfill missing generations for all configs
set -uo pipefail
cd /Users/yassh/baxbench

export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
export BAXBENCH_PROXY_KEY="baxbench-local-key"

LOG="backfill.log"
SCENARIOS=(Calculator ClickCount Compiler CreditCardService FileSearch Forum FrameExtract ImageConverter ImageTransfer Logger Login Monitor PDFCat PDFToText ProductCatalog ProfileCollection Recipes RecommendationService RegexSearch SecretStorage ShopOverview ShoppingCartService SongDownloader Unsubscribe UptimeService UserCreation Wiki ZipToTxt)
ENVS=(Python-Flask JavaScript-express Go-Fiber)
SAFETY=(none generic specific)

echo "=== Backfill started at $(date) ===" | tee -a "$LOG"

for config in sonnet-4.5-thinking sonnet-4-standard sonnet-4-thinking opus-4-standard opus-4-thinking opus-4.1-standard opus-4.1-thinking; do
    model=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config':
        print(c['model'])
        break
" 2>/dev/null)

    thinking=$(pipenv run python -c "
from scripts.rate_limit_queue import MODEL_CONFIGS
for c in MODEL_CONFIGS:
    if c['name'] == '$config':
        print('1' if c['thinking'] else '0')
        break
" 2>/dev/null)

    # Set thinking env var
    if [ "$thinking" = "0" ]; then
        export BAXBENCH_NO_THINKING=1
    else
        unset BAXBENCH_NO_THINKING 2>/dev/null || true
    fi

    count=0
    for scenario in "${SCENARIOS[@]}"; do
        for env in "${ENVS[@]}"; do
            for sp in "${SAFETY[@]}"; do
                code_dir="results/$config/$model/$scenario/$env/temp0.2-openapi-$sp/sample0/code"
                if [ ! -d "$code_dir" ] || [ -z "$(ls -A "$code_dir" 2>/dev/null)" ]; then
                    count=$((count + 1))
                    echo "[$config] Backfilling $scenario/$env/$sp ($count)..." | tee -a "$LOG"
                    pipenv run python src/main.py \
                        --models "$model" \
                        --mode generate \
                        --scenarios "$scenario" \
                        --envs "$env" \
                        --safety_prompt "$sp" \
                        --n_samples 1 \
                        --temperature 0.2 \
                        --results_dir "results/$config" 2>&1 | tail -1 | tee -a "$LOG"
                fi
            done
        done
    done
    echo "[$config] Backfilled $count items" | tee -a "$LOG"
done

echo "=== Backfill complete at $(date) ===" | tee -a "$LOG"
