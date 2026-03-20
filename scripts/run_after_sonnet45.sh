#!/usr/bin/env bash
# Complete sonnet-4.5-standard (test remaining safety prompts + evaluate), then run overnight configs
set -uo pipefail

cd /Users/yassh/baxbench

export BAXBENCH_PROXY_URL="http://localhost:8317/v1"
export BAXBENCH_PROXY_KEY="baxbench-local-key"

ENVS=("Python-Flask" "JavaScript-express" "Go-Fiber")

# Test remaining safety prompts for sonnet-4.5-standard
# (none was already tested, now do generic and specific)
for SP in generic specific; do
    echo "=== Testing sonnet-4.5-standard (safety=$SP) ==="
    pipenv run python src/main.py \
        --models claude-sonnet-4-5-20250929 \
        --mode test \
        --safety_prompt "$SP" \
        --results_dir results/sonnet-4.5-standard \
        --envs "${ENVS[@]}" 2>&1 || echo "WARN: test had errors for $SP"
done

# Evaluate sonnet-4.5-standard (all safety prompts)
for SP in none generic specific; do
    echo "=== Evaluating sonnet-4.5-standard (safety=$SP) ==="
    pipenv run python src/main.py \
        --models claude-sonnet-4-5-20250929 \
        --mode evaluate \
        --safety_prompt "$SP" \
        --results_dir results/sonnet-4.5-standard \
        --envs "${ENVS[@]}" 2>&1 || echo "WARN: evaluate had errors for $SP"
done

echo "=== sonnet-4.5-standard done, starting overnight queue ==="

# Run overnight configs
exec ./scripts/run_overnight.sh
