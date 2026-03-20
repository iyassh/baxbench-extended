#!/usr/bin/env bash
# Test configs that already have all code generated, while opus-4.1-thinking backfill continues
set -uo pipefail
cd /Users/yassh/baxbench

LOG="test_now.log"
ENVS=("Python-Flask" "JavaScript-express" "Go-Fiber")

echo "=== Testing started at $(date) ===" | tee -a "$LOG"

# haiku: missing 'specific'
echo "[haiku-4.5-standard] Testing specific" | tee -a "$LOG"
pipenv run python src/main.py --models claude-haiku-4-5-20251001 --mode test --safety_prompt specific --results_dir results/haiku-4.5-standard --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || true
docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"

# sonnet-4.5-thinking: 248/252, re-run all 3 to catch missing
for SP in none generic specific; do
    echo "[sonnet-4.5-thinking] Testing $SP" | tee -a "$LOG"
    pipenv run python src/main.py --models claude-sonnet-4-5-20250929 --mode test --safety_prompt "$SP" --results_dir results/sonnet-4.5-thinking --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || true
done
docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"

# sonnet-4.6-standard: 247/252
for SP in none generic specific; do
    echo "[sonnet-4.6-standard] Testing $SP" | tee -a "$LOG"
    pipenv run python src/main.py --models claude-sonnet-4-6 --mode test --safety_prompt "$SP" --results_dir results/sonnet-4.6-standard --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || true
done
docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"

# opus-4-thinking: 245/252
for SP in none generic specific; do
    echo "[opus-4-thinking] Testing $SP" | tee -a "$LOG"
    pipenv run python src/main.py --models claude-opus-4-20250514 --mode test --safety_prompt "$SP" --results_dir results/opus-4-thinking --envs "${ENVS[@]}" 2>&1 | tee -a "$LOG" || true
done
docker image prune -f 2>&1 | tail -1 | tee -a "$LOG"

echo "=== Testing batch done at $(date) ===" | tee -a "$LOG"
