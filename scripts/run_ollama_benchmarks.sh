#!/bin/bash
# Run full benchmark for codellama:7b, qwen2.5-coder:7b, mistral:7b via Ollama
# RAM-optimised for 8GB M1: stop Ollama during test phase (Docker only), restart for next model
set -e

LOGFILE="/tmp/ollama_benchmarks_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOGFILE") 2>&1

echo "===== OLLAMA BENCHMARK RUN ====="
echo "Started: $(date)"
echo "Log: $LOGFILE"
echo ""

SCENARIOS="Calculator ClickCount Compiler CreditCardService FileSearch Forum FrameExtract ImageConverter ImageTransfer Logger Login Monitor PDFCat PDFToText ProductCatalog ProfileCollection Recipes RecommendationService RegexSearch SecretStorage ShopOverview ShoppingCartService SongDownloader Unsubscribe UptimeService UserCreation Wiki ZipToTxt"
FRAMEWORKS="Python-Flask JavaScript-express Go-Fiber"
SAFETY_PROMPTS="none generic specific"

OVERALL_STATUS=0

for MODEL in "codellama:7b" "qwen2.5-coder:7b" "mistral:7b"; do
    MODEL_DIR=$(echo "$MODEL" | sed 's/:/-/g')
    RESULTS_DIR="results/${MODEL_DIR}-ollama"

    echo ""
    echo "========================================"
    echo "MODEL: $MODEL"
    echo "RESULTS_DIR: $RESULTS_DIR"
    echo "Started: $(date)"
    echo "========================================"

    # Ensure Ollama is running for generation
    brew services start ollama 2>/dev/null || true
    sleep 3

    # Pull model
    echo "--- Pulling $MODEL ---"
    ollama pull "$MODEL"
    echo "Pull complete for $MODEL"

    MODEL_STATUS=0

    # GENERATION PHASE — only Ollama needed, Docker not used
    echo ""
    echo "--- GENERATION PHASE: $MODEL (Ollama ON, Docker idle) ---"
    for SAFETY in $SAFETY_PROMPTS; do
        echo "  Generating safety_prompt=$SAFETY at $(date)"
        if cd /Users/deepanshsharma/baxbench-extended && python3 src/main.py \
            --models "$MODEL" \
            --mode generate \
            --ollama \
            --safety_prompt "$SAFETY" \
            --scenarios $SCENARIOS \
            --envs $FRAMEWORKS \
            --results_dir "$RESULTS_DIR" \
            --n_samples 1; then
            echo "  Generation OK: safety_prompt=$SAFETY"
        else
            echo "  ERROR during generation safety_prompt=$SAFETY for $MODEL"
            MODEL_STATUS=1
            OVERALL_STATUS=1
        fi
    done

    # Stop Ollama to free RAM before Docker-heavy test phase
    echo ""
    echo "--- Stopping Ollama to free RAM for test phase ---"
    brew services stop ollama 2>/dev/null || true
    sleep 5
    echo "Ollama stopped. Free RAM for Docker containers."

    # TEST PHASE — only Docker needed, Ollama is off
    echo ""
    echo "--- TEST PHASE: $MODEL (Ollama OFF, Docker active) ---"
    for SAFETY in $SAFETY_PROMPTS; do
        echo "  Testing safety_prompt=$SAFETY at $(date)"
        if cd /Users/deepanshsharma/baxbench-extended && python3 src/main.py \
            --models "$MODEL" \
            --mode test \
            --safety_prompt "$SAFETY" \
            --scenarios $SCENARIOS \
            --envs $FRAMEWORKS \
            --results_dir "$RESULTS_DIR"; then
            echo "  Test OK: safety_prompt=$SAFETY"
        else
            echo "  ERROR during testing safety_prompt=$SAFETY for $MODEL"
            MODEL_STATUS=1
            OVERALL_STATUS=1
        fi
    done

    if [ $MODEL_STATUS -eq 0 ]; then
        echo ""
        echo "SUCCESS: $MODEL completed at $(date)"
    else
        echo ""
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
if [ $OVERALL_STATUS -eq 0 ]; then
    echo "Overall status: SUCCESS"
else
    echo "Overall status: FAILED (check log for details)"
fi
exit $OVERALL_STATUS
