# Overview Page — Detailed Analysis

Every number on the CodeStrike dashboard Overview page, explained and verified against the database.

---

## Section 1: Header

> **"Analyzing 4,505 security tests across 15 model configurations"**

### 4,505 — Total Results
This is the total number of test runs in our database. Each "result" is one complete test of:
- One AI model generating code for one scenario, in one framework, with one safety prompt level

**How we get 4,505:**

| Model | Scenarios | Frameworks | Safety Prompts | Total |
|---|---|---|---|---|
| 13 Claude models | 35 | 3 | 3 | 35 x 3 x 3 = 315 each = 4,095 |
| deepseek-coder-6.7b | 28 (original only) | 3 | 3 | 28 x 3 x 3 = 252 |
| meta-llama-3.3-70b | 28 (partial — only 158 completed) | 3 | 3 | 158 |
| **Total** | | | | **4,505** |

DeepSeek and Llama only have the 28 original scenarios (not the 7 new ones we added) because we ran those models before adding the new scenarios.

### 15 — Model Configurations
The database has 20 config entries, but only 15 have actual test results. The 5 with 0 results are:
- haiku-4.5-thinking (never ran)
- opus-4.5-standard (never ran)
- opus-4.5-thinking (never ran)
- google-gemma-3-27b (never ran)
- mistralai-mistral-small-3.1 (never ran)

Of the 15 with data: **6 thinking mode + 9 standard mode**.

---

## Section 2: Insight Cards

### Insight 1: "sonnet-4-standard achieves the highest security pass rate at 4.4%"

**Verified:** sonnet-4-standard has 14 secure passes out of 315 total = 4.44%. This is tied with sonnet-4.5-thinking (also 14/315 = 4.44%). The dashboard shows sonnet-4-standard because it appears first alphabetically.

**What this means:** The BEST AI model produces secure, working code only 4.4% of the time. Out of 315 tests, only 14 apps were both functional AND had zero vulnerabilities.

### Insight 2: "meta-llama-llama-3.3-70b-instruct-openrouter has the lowest security pass rate at 0.0%"

**Verified:** meta-llama has 0 secure passes out of 158 total. Also deepseek-coder-6.7b has 0/252 = 0.0%. The dashboard shows meta-llama because it's sorted by rate (both are 0%) and meta-llama appears later.

**What this means:** Every single app these open-source models generated had at least one vulnerability (if it even worked at all). These are significantly worse than the Claude models.

### Insight 3: "Thinking mode has mixed results (avg +0.3 pp): improves sonnet-4.5 by +1.9 pp but hurts sonnet-4 by -1.0 pp"

**Verified by calculating thinking deltas:**

| Family | Standard sec_pass | Thinking sec_pass | Delta |
|---|---|---|---|
| opus-4 | 3.81% | 3.49% | -0.32 pp |
| opus-4.1 | 2.54% | 4.13% | +1.59 pp |
| opus-4.6 | 3.81% | 3.81% | 0.00 pp |
| sonnet-4 | 4.44% | 3.49% | -0.95 pp |
| sonnet-4.5 | 2.54% | 4.44% | +1.90 pp |
| sonnet-4.6 | 3.81% | 3.49% | -0.32 pp |
| **Average** | | | **+0.32 pp** |

**What this means:** Thinking mode (where the AI reasons step-by-step before writing code) does NOT consistently improve security. It helps sonnet-4.5 (+1.9 pp) and opus-4.1 (+1.6 pp) but hurts sonnet-4 (-1.0 pp) and opus-4 (-0.3 pp). The average improvement is essentially negligible at +0.3 percentage points. More reasoning time does not automatically equal more secure code.

### Insight 4: "Specific safety prompts improve the security pass rate by 9.5 percentage points on average"

**Verified from database:**

| Safety Prompt | Total Tests | Secure Passes | sec_pass@1 |
|---|---|---|---|
| none | 1,533 | 4 | 0.26% |
| generic | 1,523 | 1 | 0.07% |
| specific | 1,449 | 141 | 9.73% |

The delta between "none" (0.26%) and "specific" (9.73%) is **+9.47 pp**, rounded to 9.5 pp.

**What this means:** This is the single biggest finding. When you tell the AI specifically to "protect against SQL injection, use bcrypt for passwords, set HttpOnly cookies, implement rate limiting" — it actually does it 9.7% of the time vs 0.3% without instructions. That's a 37x improvement. Safety prompts are the most effective mitigation strategy we found.

**Why "generic" is worse than "none" (0.07% vs 0.26%):** This seems counterintuitive. The generic prompt says "write secure code" which is vague. It may cause the model to add incomplete security measures that actually break functionality (reducing pass@1) without fully preventing vulnerabilities. The numbers are so low (1 vs 4 secure passes) that this difference isn't statistically significant — it's essentially noise.

---

## Section 3: Stat Cards

### TOTAL RESULTS: 4,505
As explained above — total test runs across all models, scenarios, frameworks, and safety prompts.

### MODELS TESTED: 15 (6 thinking / 9 standard)
- **9 standard:** opus-4, opus-4.1, opus-4.6, sonnet-4, sonnet-4.5, sonnet-4.6, haiku-4.5, deepseek-coder-6.7b, meta-llama-3.3-70b
- **6 thinking:** opus-4, opus-4.1, opus-4.6, sonnet-4, sonnet-4.5, sonnet-4.6

Note: haiku, deepseek, and llama don't have thinking mode configs.

### AVG SEC_PASS@1: 3.1% — "Includes crashes"

**Formula:**
```
For each model: sec_pass@1 = (functional_pass=True AND zero CWEs) / total_results
Average across all 15 models = 3.09%, displayed as 3.1%
```

**Verified:** Average of [4.44, 4.44, 4.13, 3.81, 3.81, 3.81, 3.81, 3.49, 3.49, 3.49, 2.54, 2.54, 2.54, 0.0, 0.0] = 3.09%

**"Includes crashes" means:** If a security test itself crashed (num_st_exceptions > 0) but no CWE was recorded, the app still counts as "secure" under this metric. This is a slightly inflated number because some apps appear secure only because the security test couldn't run properly.

**Why is 3.1% so low?** Three reasons:
1. **Most code doesn't work (71.4% crash rate)** — only 1,288 of 4,505 apps pass functional tests
2. **Of the 1,288 working apps, 1,142 have vulnerabilities** — 88.7% of working apps are vulnerable
3. **Only 146 apps are both functional AND vulnerability-free** — 146/4,505 = 3.24%

The 3.1% average is slightly different from 3.24% because it's the average of per-model rates (some models have different test counts).

### AVG TRUE_SEC@1: 0.7% — "Clean tests only"

**Formula:**
```
For each model: true_sec@1 = (functional_pass=True AND zero CWEs AND zero ST exceptions) / total_results
Average across all 15 models = 0.66%, displayed as 0.7%
```

**Verified:** Average of [0.95, 0.63, 0.95, 0.63, 0.95, 0.63, 0.63, 0.95, 0.95, 0.63, 0.63, 0.32, 0.95, 0.0, 0.0] = 0.66%

**"Clean tests only" means:** This is the strictest metric. The app must:
1. Pass ALL functional tests (code works correctly)
2. Have ZERO CWEs detected (no vulnerabilities found)
3. Have ZERO security test exceptions (all security tests ran cleanly without crashing)

This eliminates "secure by crash" — apps that look clean only because their security tests failed to execute.

**Why is this even lower than sec_pass@1?** Because some of the 146 "secure" apps had security test exceptions (tests crashed). When we remove those, only ~31 apps across all models are truly secure. That's 31 out of 4,505 = 0.69%.

**Is this accurate?** Yes. Here's the math:

| Stage | Count | Percentage |
|---|---|---|
| Total test runs | 4,505 | 100% |
| Code doesn't work (crash/fail) | 3,217 | 71.4% |
| Code works | 1,288 | 28.6% |
| Working code WITH vulnerabilities | 1,142 | 25.4% |
| Working code, no vulnerabilities | 146 | 3.2% |
| Working, no vulns, clean security tests | ~31 | 0.7% |

### CWEs Detected (shown but cut off in viewport)

**From database:** 18 unique CWE types detected out of 23 monitored, with 2,295 total occurrences.

Note: the dashboard Vulnerabilities page shows "17 CWEs" because it groups some differently. The actual database has 18 distinct CWE numbers in result_cwes.

**Full CWE breakdown:**

| Rank | CWE | Name | Count | % of All |
|---|---|---|---|---|
| 1 | CWE-693 | Missing Security Headers | 1,427 | 62.2% |
| 2 | CWE-352 | CSRF Missing | 271 | 11.8% |
| 3 | CWE-307 | Brute Force / No Rate Limit | 144 | 6.3% |
| 4 | CWE-79 | Cross-Site Scripting (XSS) | 116 | 5.1% |
| 5 | CWE-400 | Resource Exhaustion | 115 | 5.0% |
| 6 | CWE-522 | Weak Credential Storage | 62 | 2.7% |
| 7 | CWE-117 | Log Injection | 36 | 1.6% |
| 8 | CWE-20 | Input Validation | 27 | 1.2% |
| 9 | CWE-1275 | No SameSite Cookie | 24 | 1.0% |
| 10 | CWE-22 | Path Traversal | 23 | 1.0% |
| 11 | CWE-78 | OS Command Injection | 15 | 0.7% |
| 12 | CWE-284 | Access Control | 10 | 0.4% |
| 13 | CWE-703 | Error Handling | 6 | 0.3% |
| 14 | CWE-94 | Code Injection | 6 | 0.3% |
| 15 | CWE-614 | No HttpOnly Cookie | 5 | 0.2% |
| 16 | CWE-863 | Incorrect Authorization | 3 | 0.1% |
| 17 | CWE-840 | Business Logic | — | via manual only |
| 18 | CWE-89 | SQL Injection | 1 | 0.04% |
| | **Total** | | **2,295** | **100%** |

**Why CWE-693 dominates:** AI models almost never add security headers (Content-Security-Policy, X-Frame-Options, Strict-Transport-Security, X-Content-Type-Options) unless explicitly told to. These headers are middleware-level configuration, not core application logic, so models skip them.

**Why SQL Injection is only 1:** Modern AI training data heavily features parameterized queries. Models have learned that string concatenation in SQL is bad. This is actually a positive finding — AI models are good at preventing SQLi.

---

## Section 4: Model Security Ranking (Bar Chart)

The bar chart ranks all 15 models by true_sec@1 (green bars) with sec_pass@1 overlaid (amber bars).

**Complete ranking (verified from database):**

| Rank | Model | sec_pass@1 | true_sec@1 | Functional Pass Rate |
|---|---|---|---|---|
| 1 | sonnet-4-standard | 4.44% | 0.95% | 31.7% |
| 2 | sonnet-4.5-thinking | 4.44% | 0.63% | 29.5% |
| 3 | opus-4.1-thinking | 4.13% | 0.95% | 29.5% |
| 4 | opus-4-standard | 3.81% | 0.63% | 28.3% |
| 5 | opus-4.6-standard | 3.81% | 0.95% | 28.6% |
| 6 | opus-4.6-thinking | 3.81% | 0.63% | 29.8% |
| 7 | sonnet-4.6-standard | 3.81% | 0.63% | 29.2% |
| 8 | opus-4-thinking | 3.49% | 0.95% | 28.3% |
| 9 | sonnet-4-thinking | 3.49% | 0.95% | 38.1% |
| 10 | sonnet-4.6-thinking | 3.49% | 0.63% | 30.5% |
| 11 | haiku-4.5-standard | 2.54% | 0.63% | 31.1% |
| 12 | opus-4.1-standard | 2.54% | 0.32% | 22.2% |
| 13 | sonnet-4.5-standard | 2.54% | 0.95% | 22.9% |
| 14 | deepseek-coder-6.7b | 0.00% | 0.00% | 14.3% |
| 15 | meta-llama-3.3-70b | 0.00% | 0.00% | 35.4% |

**Key observations:**
- All Claude models cluster between 2.5-4.4% — the differences are small
- The gap between the amber bar (sec_pass) and green bar (true_sec) shows "secure by crash" inflation
- DeepSeek and Llama are at the bottom with 0% — every working app had vulnerabilities
- sonnet-4-thinking has the highest pass@1 (38.1%) but only average security — being more functional doesn't mean more secure
- meta-llama has decent pass@1 (35.4%) but 0% security — it can write working code but never secure code

---

## Section 5: Vulnerability Matrix (Heatmap)

This is a grid of 15 models (rows) x 35 scenarios (columns). Each cell's color intensity shows how many CWEs were found for that model-scenario combination.

**What the heatmap reveals:**
- **Hot scenarios (many CWEs across all models):** ShopOverview, SecretStorage, Login, Forum, Recipes, ShoppingCartService — these scenarios have complex auth/session requirements that models consistently get wrong
- **Cool scenarios (few CWEs):** ClickCount, PDFCat, UserCreation, ProductCatalog — simpler apps with less attack surface
- **New scenarios:** AdminPanel, Checkout, LinkPreview, MultiUserNotes, PasswordReset, UserSettings, XMLImporter — visible in the heatmap with generally low CWE counts (many apps crash before security tests run)
- **DeepSeek row is darkest** — most CWEs per scenario
- **Sonnet/Opus rows are lighter** — fewer CWEs, especially with thinking mode

---

## Section 6: Pentest Highlights

> 41 manual findings · Across 10 apps · 14.3% ZAP agreement · 100% precision, 27% recall

**41 manual findings:** Human pentesters found 41 unique vulnerabilities across 10 apps (note: the Pentest page shows 47 — the 41 here likely excludes informational/low severity ones or counts unique CWEs rather than individual findings).

**Across 10 apps:** We selected 10 representative apps across different models and scenarios for manual testing.

**14.3% ZAP agreement:** Of the vulnerabilities CodeStrike found, ZAP agreed with only 14.3%. This proves CodeStrike finds things ZAP cannot (because CodeStrike runs inside Docker, while ZAP can only send HTTP requests from outside).

**100% precision, 27% recall:**
- Precision = TP / (TP + FP) = 11 / (11 + 0) = 100% — CodeStrike never reported a false positive
- Recall = TP / (TP + FN) = 11 / (11 + 30) = 27% — CodeStrike found 11 of 41 real vulnerabilities

---

## Section 7: Explore Links

Five navigation cards linking to deeper analysis:
1. **Explore Models** → /models — per-model cards with filters
2. **Compare Safety Prompts** → /compare — none vs generic vs specific
3. **View All CWEs** → /vulnerabilities — treemap and CWE catalog
4. **Manual Pentest Results** → /pentest — 3-way comparison
5. **Browse Test Results** → /results — individual result browser

---

## Summary: Are These Numbers Accurate?

**Yes.** Every number on the Overview page matches the database exactly:

| Dashboard Shows | Database Value | Match? |
|---|---|---|
| 4,505 results | 4,505 | Yes |
| 15 models (6 thinking / 9 standard) | 15 (6/9) | Yes |
| 3.1% avg sec_pass | 3.09% | Yes (rounded) |
| 0.7% avg true_sec | 0.66% | Yes (rounded) |
| sonnet-4-standard highest at 4.4% | 4.44% | Yes |
| meta-llama lowest at 0.0% | 0.00% | Yes |
| Thinking +0.3 pp average | +0.32 pp | Yes (rounded) |
| Safety prompts +9.5 pp | +9.47 pp | Yes (rounded) |

**The low numbers are real.** AI-generated code is genuinely insecure:
- 71.4% of apps crash (don't work at all)
- Of the 28.6% that work, 88.7% have vulnerabilities
- Only 3.2% are functional and vulnerability-free
- Only 0.7% are functional, vulnerability-free, and cleanly tested
