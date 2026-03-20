#!/usr/bin/env bash
# Watch for sonnet-4.5-standard test to finish, then chain evaluate + overnight
set -uo pipefail

TEST_PID=91964
LOG="watch_chain.log"

echo "=== Watcher started at $(date) ===" | tee -a "$LOG"
echo "Watching PID $TEST_PID (sonnet-4.5-standard test phase)" | tee -a "$LOG"

# Wait for the test process to finish
while kill -0 "$TEST_PID" 2>/dev/null; do
    TESTS=$(find results/sonnet-4.5-standard -name "test_results.json" 2>/dev/null | wc -l | tr -d ' ')
    echo "[$(date +%H:%M)] Test PID $TEST_PID still running. Test results: $TESTS/252" | tee -a "$LOG"
    sleep 120  # Check every 2 minutes
done

echo "" | tee -a "$LOG"
echo "=== Test process finished at $(date) ===" | tee -a "$LOG"
FINAL=$(find results/sonnet-4.5-standard -name "test_results.json" 2>/dev/null | wc -l | tr -d ' ')
echo "Final test results count: $FINAL" | tee -a "$LOG"

# Now run the chaining script (evaluate sonnet-4.5 + overnight benchmarks)
echo "=== Starting evaluate + overnight chain at $(date) ===" | tee -a "$LOG"
exec ./scripts/run_after_sonnet45.sh 2>&1 | tee -a "$LOG"
