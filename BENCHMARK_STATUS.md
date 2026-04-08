# 🚀 DeepSeek Coder Full Benchmark - Running

**Started:** March 24, 2026 at 15:55
**Model:** DeepSeek Coder 6.7B (Ollama - 100% Free!)
**Status:** ⏳ IN PROGRESS

---

## 📊 Benchmark Scope

**Total Tests:** 252
- **28 Scenarios** (all CodeStrike scenarios)
- **3 Frameworks** (Python-Flask, JavaScript-express, Go-Fiber)
- **3 Safety Levels** (none, generic, specific)

**Calculation:** 28 × 3 × 3 = 252 tests

---

## ⏱️ Estimated Timeline

### Phase 1: Code Generation (Current)
- **84 tests** with `safety_prompt=none` (~25 minutes)
- **84 tests** with `safety_prompt=generic` (~25 minutes)
- **84 tests** with `safety_prompt=specific` (~25 minutes)
- **Total Generation:** ~75 minutes (~1.25 hours)

### Phase 2: Security Testing
- **252 Docker tests** (~2-3 hours depending on system)
- Tests run in Docker containers to check for vulnerabilities

### Total Time: ~4-5 hours

---

## 📁 Results Location

```
results/deepseek-coder-6.7b-ollama/
└── deepseek-coder:6.7b/
    ├── Calculator/
    │   ├── Python-Flask/
    │   │   ├── temp0.2-openapi-none/
    │   │   ├── temp0.2-openapi-generic/
    │   │   └── temp0.2-openapi-specific/
    │   ├── JavaScript-express/
    │   └── Go-Fiber/
    ├── Login/
    ├── Forum/
    └── ... (28 scenarios total)
```

---

## 📈 Current Progress

Check real-time progress:

```bash
# View live log
tail -f /tmp/deepseek_benchmark_run.log

# Count completed tests
find results/deepseek-coder-6.7b-ollama -name "app.py" | wc -l

# Check specific log file
tail -f /tmp/deepseek_benchmark_*.log
```

---

## ✅ What Happens Next

### 1. After Generation Completes

The script automatically starts testing:

```bash
python3 src/main.py --models deepseek-coder:6.7b --mode test --ollama ...
```

### 2. Load Results into Database

```bash
python3 scripts/load_results_db.py
```

This will:
- Read all 252 test results
- Parse CWE vulnerabilities found
- Store in `dashboard/codestrike.db`

### 3. View in Dashboard

```bash
cd dashboard
npm run dev
```

Visit http://localhost:3000 to see:
- DeepSeek Coder 6.7B results
- Comparison with Claude models
- Vulnerability breakdown by CWE
- Safety prompt effectiveness

---

## 🎯 Expected Results

Based on similar models, DeepSeek Coder should show:

- **Without safety prompts:** High vulnerability rate (~80-90% vulnerable)
- **With generic safety:** Moderate improvement (~30-50% vulnerable)
- **With specific safety:** Best results (~10-30% vulnerable)

**Common CWEs to expect:**
- CWE-89: SQL Injection
- CWE-79: Cross-Site Scripting (XSS)
- CWE-22: Path Traversal
- CWE-78: OS Command Injection
- CWE-693: Missing Security Headers

---

## 💰 Cost Comparison

| Model | API Cost (252 tests) | DeepSeek (Ollama) |
|-------|---------------------|-------------------|
| Claude Opus 4.1 | ~$50-100 | **$0.00** ✅ |
| Claude Sonnet 4.5 | ~$20-40 | **$0.00** ✅ |
| GPT-4 | ~$30-60 | **$0.00** ✅ |
| **DeepSeek Local** | **FREE** | **FREE** |

**Total savings: $50-100+ per full benchmark run!**

---

## 🔍 Monitoring Commands

```bash
# Watch progress
watch -n 5 'find results/deepseek-coder-6.7b-ollama -name "app.py" | wc -l'

# Check log
tail -f /tmp/deepseek_benchmark_*.log

# See what's currently being generated
ps aux | grep "python3 src/main.py"

# Check Ollama is running
curl http://localhost:11434/api/tags

# Monitor system resources
top -pid $(pgrep -f ollama)
```

---

## 🎓 For Your COMP 4210 Project

This benchmark gives you:

1. ✅ **Complete dataset** matching Yash's Claude results
2. ✅ **Free alternative** to expensive API models
3. ✅ **252 test results** for comprehensive analysis
4. ✅ **All 28 security scenarios** covered
5. ✅ **3 frameworks** (Python, JavaScript, Go)
6. ✅ **Safety prompt comparison** (none vs generic vs specific)
7. ✅ **Dashboard visualization** ready

---

## 📝 Next Steps After Completion

1. **Analyze Results**
   - Compare DeepSeek vs Claude models
   - Identify which scenarios DeepSeek struggles with
   - Document safety prompt effectiveness

2. **Manual Penetration Testing**
   - Use the 5 vulnerable apps we generated earlier
   - Document findings vs automated tests
   - Screenshot exploits

3. **Write Report**
   - Compare free vs paid models
   - Security analysis across frameworks
   - Recommendations for secure AI code generation

---

## ⚡ Quick Reference

**Start monitoring:**
```bash
./scripts/monitor_benchmark.sh  # (if created)
```

**Stop if needed:**
```bash
pkill -f "python3 src/main.py"
```

**Resume from checkpoint:**
The benchmark has checkpointing built-in. If it crashes, just re-run the script.

---

**Last Updated:** Benchmark in progress...
**Check status:** `tail -20 /tmp/deepseek_benchmark_run.log`
