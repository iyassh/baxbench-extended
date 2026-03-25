#!/bin/bash
# Run full DeepSeek Coder benchmark matching Claude model tests
# This replicates the 252 tests per model (28 scenarios × 3 frameworks × 3 safety levels)

set -e

MODEL="deepseek-coder:6.7b"
RESULTS_DIR="results/deepseek-coder-6.7b-ollama"
LOG_FILE="/tmp/deepseek_benchmark_$(date +%Y%m%d_%H%M%S).log"

echo "🚀 Starting Full DeepSeek Coder Benchmark" | tee -a "$LOG_FILE"
echo "=========================================" | tee -a "$LOG_FILE"
echo "Model: $MODEL" | tee -a "$LOG_FILE"
echo "Results: $RESULTS_DIR" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# All scenarios (28 total)
SCENARIOS="Calculator ClickCount Compiler CreditCardService FileSearch Forum FrameExtract ImageConverter ImageTransfer Logger Login Monitor PDFCat PDFToText ProductCatalog ProfileCollection Recipes RecommendationService RegexSearch SecretStorage ShopOverview ShoppingCartService SongDownloader Unsubscribe UptimeService UserCreation Wiki ZipToTxt"

# All frameworks (3 total)
FRAMEWORKS="Python-Flask JavaScript-express Go-Fiber"

# All safety prompts (3 total)
SAFETY_PROMPTS="none generic specific"

# Total: 28 × 3 × 3 = 252 tests

TOTAL_TESTS=252
CURRENT_TEST=0
START_TIME=$(date +%s)

echo "📊 Total tests to run: $TOTAL_TESTS" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Run generation for each safety prompt level
for SAFETY in $SAFETY_PROMPTS; do
    echo "🔐 Generating code with safety_prompt=$SAFETY..." | tee -a "$LOG_FILE"

    python3 src/main.py \
        --models "$MODEL" \
        --mode generate \
        --ollama \
        --safety_prompt "$SAFETY" \
        --scenarios $SCENARIOS \
        --envs $FRAMEWORKS \
        --results_dir "$RESULTS_DIR" \
        --n_samples 1 \
        2>&1 | tee -a "$LOG_FILE"

    if [ $? -eq 0 ]; then
        echo "✅ Safety prompt '$SAFETY' generation complete!" | tee -a "$LOG_FILE"
    else
        echo "❌ Error during '$SAFETY' generation" | tee -a "$LOG_FILE"
        exit 1
    fi

    echo "" | tee -a "$LOG_FILE"
done

END_GEN_TIME=$(date +%s)
GEN_DURATION=$((END_GEN_TIME - START_TIME))

echo "✅ Code generation complete! Duration: ${GEN_DURATION}s ($(($GEN_DURATION / 60))m)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

echo "🧪 Starting security tests..." | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Run tests for each safety prompt level
for SAFETY in $SAFETY_PROMPTS; do
    echo "🔍 Testing code with safety_prompt=$SAFETY..." | tee -a "$LOG_FILE"

    python3 src/main.py \
        --models "$MODEL" \
        --mode test \
        --safety_prompt "$SAFETY" \
        --scenarios $SCENARIOS \
        --envs $FRAMEWORKS \
        --results_dir "$RESULTS_DIR" \
        2>&1 | tee -a "$LOG_FILE"

    if [ $? -eq 0 ]; then
        echo "✅ Safety prompt '$SAFETY' testing complete!" | tee -a "$LOG_FILE"
    else
        echo "❌ Error during '$SAFETY' testing" | tee -a "$LOG_FILE"
        exit 1
    fi

    echo "" | tee -a "$LOG_FILE"
done

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo "🎉 BENCHMARK COMPLETE!" | tee -a "$LOG_FILE"
echo "===================" | tee -a "$LOG_FILE"
echo "Total duration: ${TOTAL_DURATION}s ($(($TOTAL_DURATION / 60))m)" | tee -a "$LOG_FILE"
echo "Generation: ${GEN_DURATION}s" | tee -a "$LOG_FILE"
echo "Testing: $((TOTAL_DURATION - GEN_DURATION))s" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "📁 Results saved to: $RESULTS_DIR" | tee -a "$LOG_FILE"
echo "📋 Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "🔄 Next step: Load results into database:" | tee -a "$LOG_FILE"
echo "   python3 scripts/load_results_db.py" | tee -a "$LOG_FILE"
