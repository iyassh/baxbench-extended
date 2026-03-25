# Running BaxBench with Ollama on Another Laptop

**Last Updated:** March 25, 2026
**Repository:** https://github.com/iyassh/baxbench-extended
**Latest Commit:** 668b8cc (DeepSeek integration + Dashboard fixes)

This guide shows how to set up and run BaxBench security benchmarks with free Ollama models on a different laptop.

## ✅ What's Already in the Repository

The following has been completed and pushed to git:

- ✅ **Ollama integration** - Free AI models via `src/ollama_adapter.py`
- ✅ **DeepSeek benchmark complete** - 252 test results at 42.9% sec_pass@1
- ✅ **Dashboard fixed** - sec_pass@1 now correctly calculates security-only metric
- ✅ **Full documentation** - Setup guides, analysis, and technical details
- ✅ **Database with results** - `dashboard/baxbench.db` includes all benchmark data
- ✅ **Automated scripts** - `scripts/run_deepseek_full_benchmark.sh` and more

**Current Status:**
- Total: 3,528 test results
- Models: Claude Opus/Sonnet/Haiku + DeepSeek Coder
- Dashboard: Fully functional at http://localhost:3000

## Prerequisites

- macOS, Linux, or Windows (with WSL)
- At least 16GB RAM (32GB recommended for multiple models)
- ~50GB free disk space
- Docker Desktop installed
- Git installed
- Anthropic API key (for Claude models - optional if only using Ollama)

## Step 1: Clone the Repository

```bash
# On your other laptop
cd ~/Documents  # or your preferred location
git clone https://github.com/iyassh/baxbench-extended.git
cd baxbench-extended

# Verify you have the latest code
git pull origin main
git log --oneline -3
# Should show: 668b8cc fix: correct sec_pass@1 calculation and integrate DeepSeek
```

### Option B: Using USB/Network Transfer
```bash
# On current laptop (compress the project)
cd ~/
tar -czf baxbench-extended.tar.gz baxbench-extended/ \
  --exclude='node_modules' \
  --exclude='results/*' \
  --exclude='dashboard/.next'

# Transfer baxbench-extended.tar.gz to other laptop, then:
# On other laptop
tar -xzf baxbench-extended.tar.gz
cd baxbench-extended
```

## Step 2: Configure Anthropic API Key (Optional)

If you want to run Claude models (not just Ollama):

```bash
# Get your API key from: https://console.anthropic.com/settings/keys

# Add to your shell profile (permanent)
echo 'export ANTHROPIC_API_KEY="sk-ant-your-key-here"' >> ~/.zshrc  # macOS
# OR
echo 'export ANTHROPIC_API_KEY="sk-ant-your-key-here"' >> ~/.bashrc  # Linux

# Reload shell
source ~/.zshrc  # or ~/.bashrc

# Verify
echo $ANTHROPIC_API_KEY

# Test the API key
python3 -c "
import anthropic
client = anthropic.Anthropic()
msg = client.messages.create(
    model='claude-sonnet-4-20250514',
    max_tokens=10,
    messages=[{'role': 'user', 'content': 'Hi'}]
)
print('✅ API key works!')
"
```

**Skip this step if you only want to use free Ollama models.**

## Step 3: Install Ollama

```bash
# macOS
brew install ollama
# OR download from: https://ollama.ai/download

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama service (keep this running in a terminal)
ollama serve &

# Verify installation
ollama --version
curl http://localhost:11434/api/tags
```

## Step 4: Install Python Dependencies

```bash
cd ~/baxbench-extended

# Install required Python packages
python3 -m pip install --break-system-packages \
  requests docker openai tabulate simple-parsing \
  tqdm termcolor anthropic pdfplumber imageio \
  matplotlib pyyaml httpx
```

## Step 5: Start Docker

```bash
# Start Docker Desktop (GUI)
# Or via command line:
open -a Docker  # macOS

# Linux
sudo systemctl start docker

# Wait for Docker to start, then verify:
docker ps

# Should show empty list (no containers running yet)
```

## Step 6: Pull Ollama Models

Choose which free models you want to test:

```bash
# Code generation models (recommended)
ollama pull deepseek-coder:6.7b        # 3.8GB - Good for code
ollama pull codellama:7b               # 3.8GB - Meta's code model
ollama pull qwen2.5-coder:7b           # 4.7GB - Strong coding model

# General purpose models
ollama pull llama3.1:8b                # 4.7GB - Meta's latest
ollama pull mistral:7b                 # 4.1GB - Fast and capable
ollama pull phi3.5:latest              # 2.2GB - Lightweight

# List installed models
ollama list
```

## Step 7: Setup Dashboard (View Results)

```bash
cd dashboard

# Install Node.js dependencies (~2-3 minutes)
npm install

# Start the development server
npm run dev
```

Open http://localhost:3000 in your browser. You should see:
- ✅ Model ranking chart with all benchmarked models
- ✅ DeepSeek showing 42.9% sec_pass@1 (emerald green bars)
- ✅ Claude models showing 89-96% sec_pass@1
- ✅ Navigate to /models, /compare, /vulnerabilities pages

**The database is already included in the repository, so you'll see all existing results immediately!**

## Step 8: Run Benchmarks

### Quick Test (1 scenario, ~5 minutes)
```bash
cd ~/baxbench-extended

python3 src/main.py \
  --models deepseek-coder:6.7b \
  --mode generate \
  --ollama \
  --safety_prompt none \
  --scenarios Calculator \
  --envs Python-Flask \
  --results_dir results/test-run \
  --n_samples 1

# Then test it
python3 src/main.py \
  --models deepseek-coder:6.7b \
  --mode test \
  --safety_prompt none \
  --scenarios Calculator \
  --envs Python-Flask \
  --results_dir results/test-run
```

### Full Benchmark (252 tests, ~5 hours)

Create a script for easy execution:

```bash
# Create the benchmark script
cat > run_ollama_benchmark.sh << 'EOF'
#!/bin/bash

MODEL="$1"
if [ -z "$MODEL" ]; then
  echo "Usage: ./run_ollama_benchmark.sh <model-name>"
  echo "Example: ./run_ollama_benchmark.sh deepseek-coder:6.7b"
  exit 1
fi

# Sanitize model name for directory
MODEL_DIR=$(echo "$MODEL" | sed 's/:/-/g')
RESULTS_DIR="results/${MODEL_DIR}-ollama"
LOG_FILE="/tmp/benchmark_${MODEL_DIR}_$(date +%Y%m%d_%H%M%S).log"

echo "🚀 Starting Benchmark for $MODEL"
echo "📁 Results: $RESULTS_DIR"
echo "📋 Log: $LOG_FILE"
echo ""

# All 28 scenarios
SCENARIOS="Calculator ClickCount Compiler CreditCardService FileSearch Forum FrameExtract ImageConverter ImageTransfer Logger Login Monitor PDFCat PDFToText ProductCatalog ProfileCollection Recipes RecommendationService RegexSearch SecretStorage ShopOverview ShoppingCartService SongDownloader Unsubscribe UptimeService UserCreation Wiki ZipToTxt"

# Three frameworks
FRAMEWORKS="Python-Flask JavaScript-express Go-Fiber"

# Three safety levels
SAFETY_PROMPTS="none generic specific"

# Generate code for all safety levels
for SAFETY in $SAFETY_PROMPTS; do
  echo "🔐 Generating code with safety_prompt=$SAFETY..."
  python3 src/main.py \
    --models "$MODEL" \
    --mode generate \
    --ollama \
    --safety_prompt "$SAFETY" \
    --scenarios $SCENARIOS \
    --envs $FRAMEWORKS \
    --results_dir "$RESULTS_DIR" \
    --n_samples 1 2>&1 | tee -a "$LOG_FILE"
done

echo "✅ Code generation complete!"
echo ""
echo "🧪 Starting security tests..."

# Test all safety levels
for SAFETY in $SAFETY_PROMPTS; do
  echo "🔍 Testing code with safety_prompt=$SAFETY..."
  python3 src/main.py \
    --models "$MODEL" \
    --mode test \
    --safety_prompt "$SAFETY" \
    --scenarios $SCENARIOS \
    --envs $FRAMEWORKS \
    --results_dir "$RESULTS_DIR" 2>&1 | tee -a "$LOG_FILE"
done

echo ""
echo "🎉 BENCHMARK COMPLETE!"
echo "📁 Results: $RESULTS_DIR"
echo "📋 Log: $LOG_FILE"
EOF

# Make it executable
chmod +x run_ollama_benchmark.sh
```

### Run benchmarks for different models:

```bash
# DeepSeek Coder (3.8GB, ~5 hours)
./run_ollama_benchmark.sh deepseek-coder:6.7b

# CodeLlama (3.8GB, ~5 hours)
./run_ollama_benchmark.sh codellama:7b

# Qwen2.5 Coder (4.7GB, ~6 hours)
./run_ollama_benchmark.sh qwen2.5-coder:7b

# Run multiple models sequentially
for model in deepseek-coder:6.7b codellama:7b mistral:7b; do
  ./run_ollama_benchmark.sh "$model"
done
```

## Step 9: View Updated Results

After running new benchmarks, update the dashboard:

```bash
# Load new results into database
python3 scripts/load_results_db.py

# The dashboard will auto-refresh, or manually refresh browser (Ctrl+R)
# Your new results should appear in the charts
```

### Option A: Quick Summary (Command Line)
```bash
python3 << 'PYTHON'
import json
from pathlib import Path
from collections import defaultdict

results_dir = Path("results/deepseek-coder-6.7b-ollama/deepseek-coder:6.7b")
cwe_counts = defaultdict(int)
total_tests = 0
passed_ft = 0

for test_file in results_dir.rglob("test_results.json"):
    total_tests += 1
    data = json.loads(test_file.read_text())
    passed_ft += data.get("num_passed_ft", 0)
    for cwe in data.get("cwes", []):
        cwe_counts[cwe["num"]] += 1

print(f"Total Tests: {total_tests}")
print(f"Functional Pass Rate: {passed_ft/(total_tests*2)*100:.1f}%")
print(f"Total CWEs: {sum(cwe_counts.values())}")
print(f"\nTop 5 CWEs:")
for cwe, count in sorted(cwe_counts.items(), key=lambda x: x[1], reverse=True)[:5]:
    print(f"  CWE-{cwe}: {count}")
PYTHON
```

### Option B: Copy Results Back to Main Laptop

```bash
# On your other laptop (compress results)
cd ~/baxbench-extended
tar -czf results-ollama.tar.gz results/

# Transfer results-ollama.tar.gz back to main laptop, then:
# On main laptop
cd ~/baxbench-extended
tar -xzf results-ollama.tar.gz
python3 scripts/load_results_db.py
cd dashboard && npm run dev
# Visit http://localhost:3000
```

## Step 10: Compare Multiple Models

After running benchmarks for several models, compare them:

```bash
python3 << 'PYTHON'
from pathlib import Path
import json

models = [
    "deepseek-coder:6.7b",
    "codellama:7b",
    "qwen2.5-coder:7b"
]

print("Model Comparison:")
print("-" * 60)

for model in models:
    model_dir = model.replace(":", "-")
    results_dir = Path(f"results/{model_dir}-ollama/{model}")

    if not results_dir.exists():
        continue

    total_tests = 0
    passed_ft = 0
    total_cwes = 0

    for test_file in results_dir.rglob("test_results.json"):
        total_tests += 1
        data = json.loads(test_file.read_text())
        passed_ft += data.get("num_passed_ft", 0)
        total_cwes += len(data.get("cwes", []))

    ft_rate = passed_ft/(total_tests*2)*100 if total_tests > 0 else 0
    avg_cwes = total_cwes/total_tests if total_tests > 0 else 0

    print(f"\n{model}:")
    print(f"  Tests: {total_tests}")
    print(f"  FT Pass Rate: {ft_rate:.1f}%")
    print(f"  Avg CWEs: {avg_cwes:.2f}")
PYTHON
```

## Troubleshooting

### Ollama Not Found
```bash
# Check if Ollama is installed
which ollama

# Add to PATH if needed (macOS)
export PATH="/usr/local/bin:$PATH"
```

### Docker Connection Refused
```bash
# Start Docker Desktop
open -a Docker  # macOS
# Or start Docker service on Linux
sudo systemctl start docker

# Wait 15 seconds, then verify
docker ps
```

### Out of Memory
```bash
# Use smaller models
ollama pull phi3.5:latest  # Only 2.2GB

# Or reduce test scope
python3 src/main.py --scenarios Calculator Login Forum ...
```

### Benchmark Taking Too Long
```bash
# Test subset of scenarios (28 total available)
SCENARIOS="Calculator Login Forum FileSearch"

# Or test single framework instead of all 3
FRAMEWORKS="Python-Flask"

# This reduces 252 tests to 12 tests (~20 minutes)
```

## Available Ollama Models

### Code-Focused Models:
- `deepseek-coder:6.7b` (3.8GB) - Strong at code generation
- `codellama:7b` (3.8GB) - Meta's code specialist
- `qwen2.5-coder:7b` (4.7GB) - Alibaba's latest coder
- `starcoder2:7b` (4.0GB) - GitHub's model

### General Purpose:
- `llama3.1:8b` (4.7GB) - Meta's latest, good all-rounder
- `mistral:7b` (4.1GB) - Fast and capable
- `phi3.5:latest` (2.2GB) - Lightweight, good for testing

### Find more:
```bash
# Browse available models
ollama list
ollama search coder
```

Visit https://ollama.com/library for full model catalog.

## Performance Tips

1. **Run overnight**: Full benchmarks take 4-6 hours
2. **Use SSD**: Significantly faster than HDD
3. **Close other apps**: Free up RAM for models
4. **Monitor with htop**: `htop` to see CPU/memory usage
5. **Multiple models**: Run sequentially to avoid out of memory

## Next Steps

1. Run full benchmark for your chosen model(s)
2. Copy results back to main laptop
3. Load into dashboard for visualization
4. Compare against Claude models from main results
5. Document findings for COMP 4210 project

## Questions?

- Ollama docs: https://github.com/ollama/ollama
- BaxBench paper: Check repo README
- Model comparison: Visit dashboard after loading results
