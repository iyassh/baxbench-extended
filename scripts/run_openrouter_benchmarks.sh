#!/bin/bash
# Run full benchmark via OpenRouter free models (no local GPU/RAM needed for generation)
# Generation: OpenRouter API (cloud) | Testing: local Docker

set -e

LOGFILE="/tmp/openrouter_benchmarks_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOGFILE") 2>&1

echo "===== OPENROUTER BENCHMARK RUN ====="
echo "Started: $(date)"
echo "Log: $LOGFILE"
echo ""

if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "ERROR: OPENROUTER_API_KEY is not set"
    exit 1
fi

SCENARIOS="Calculator ClickCount Compiler CreditCardService FileSearch Forum FrameExtract ImageConverter ImageTransfer Logger Login Monitor PDFCat PDFToText ProductCatalog ProfileCollection Recipes RecommendationService RegexSearch SecretStorage ShopOverview ShoppingCartService SongDownloader Unsubscribe UptimeService UserCreation Wiki ZipToTxt"
FRAMEWORKS="Python-Flask JavaScript-express Go-Fiber"
SAFETY_PROMPTS="none generic specific"

OVERALL_STATUS=0

for MODEL in "meta-llama/llama-3.3-70b-instruct" "mistralai/mistral-small-3.1-24b-instruct" "google/gemma-3-27b-it"; do
    MODEL_DIR=$(echo "$MODEL" | sed 's|/|-|g' | sed 's/:/-/g')
    RESULTS_DIR="results/${MODEL_DIR}-openrouter"

    echo ""
    echo "========================================"
    echo "MODEL: $MODEL"
    echo "RESULTS_DIR: $RESULTS_DIR"
    echo "Started: $(date)"
    echo "========================================"

    MODEL_STATUS=0

    # GENERATION PHASE — OpenRouter API, no local RAM needed
    echo ""
    echo "--- GENERATION PHASE: $MODEL (OpenRouter cloud) ---"
    for SAFETY in $SAFETY_PROMPTS; do
        echo "  Generating safety_prompt=$SAFETY at $(date)"
        if cd /Users/deepanshsharma/baxbench-extended && python3 src/main.py \
            --models "$MODEL" \
            --mode generate \
            --openrouter \
            --safety_prompt "$SAFETY" \
            --scenarios $SCENARIOS \
            --envs $FRAMEWORKS \
            --results_dir "$RESULTS_DIR" \
            --n_samples 1 \
            --max_concurrent_runs 5; then
            echo "  Generation OK: safety_prompt=$SAFETY"
        else
            echo "  ERROR during generation safety_prompt=$SAFETY for $MODEL"
            MODEL_STATUS=1
            OVERALL_STATUS=1
        fi
    done

    # TEST PHASE — local Docker only
    echo ""
    echo "--- TEST PHASE: $MODEL (local Docker) ---"
    for SAFETY in $SAFETY_PROMPTS; do
        echo "  Testing safety_prompt=$SAFETY at $(date)"
        if cd /Users/deepanshsharma/baxbench-extended && python3 src/main.py \
            --models "$MODEL" \
            --mode test \
            --safety_prompt "$SAFETY" \
            --scenarios $SCENARIOS \
            --envs $FRAMEWORKS \
            --results_dir "$RESULTS_DIR" \
            --max_concurrent_runs 4; then
            echo "  Test OK: safety_prompt=$SAFETY"
        else
            echo "  ERROR during testing safety_prompt=$SAFETY for $MODEL"
            MODEL_STATUS=1
            OVERALL_STATUS=1
        fi
    done

    if [ $MODEL_STATUS -eq 0 ]; then
        echo "SUCCESS: $MODEL completed at $(date)"
    else
        echo "FAILED: $MODEL had errors (see above)"
    fi
done

# Load results into DB
echo ""
echo "========================================"
echo "Loading results into database..."
echo "========================================"
cd /Users/deepanshsharma/baxbench-extended
if python3 scripts/load_results_db.py; then
    echo "Database load: SUCCESS"
else
    echo "Database load: FAILED"
    OVERALL_STATUS=1
fi

echo ""
echo "===== ALL BENCHMARKS COMPLETE ====="
echo "Finished: $(date)"
echo "Log: $LOGFILE"
[ $OVERALL_STATUS -eq 0 ] && echo "Overall status: SUCCESS" || echo "Overall status: FAILED"
exit $OVERALL_STATUS
