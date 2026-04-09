# CodeStrike: A Three-Layer Security Benchmark for AI-Generated Web Applications

**Deepansh Sharma, Yaash Iyassu, Ravinder Singh, Vansh Patel**
Dept. of Computing Science, Thompson Rivers University, Kamloops, Canada
{deepansh.sharma, yaash.iyassu, ravinder.singh, vansh.patel}@mytru.ca

---

## Abstract

Large language models (LLMs) are increasingly used to generate production web application code, yet the security properties of this code remain poorly understood. This paper presents CodeStrike, an extended security benchmark that evaluates AI-generated web applications through a three-layer validation methodology: automated exploit testing, industry-standard OWASP ZAP scanning, and manual penetration testing. We tested 20 model configurations across 28 security-critical scenarios, 3 web frameworks, and 3 safety prompt levels, producing 3,686 test results. Our analysis reveals that fewer than 7% of AI-generated applications are both functional and free of detected vulnerabilities. Safety prompts have a dramatic effect: specific security instructions improve the secure pass rate from 0.0% to 21.0%, a finding with immediate practical implications. We further demonstrate that OWASP ZAP, the industry-standard dynamic application security testing (DAST) tool, achieves only 14.3% agreement with CodeStrike when scanning AI-generated JSON APIs. Manual penetration testing of 10 applications uncovered 47 vulnerabilities, of which CodeStrike's automated tests detected 11 (100% precision, 23.4% recall). These results establish that no single testing method is sufficient, and that layered security validation is essential for AI-generated code.

**Keywords** -- AI code security, large language models, penetration testing, OWASP, vulnerability detection, security benchmark

---

## I. Introduction

The adoption of AI-assisted code generation has accelerated rapidly, with industry surveys indicating that 97% of developers use AI coding tools in some capacity [1]. Tools such as GitHub Copilot, ChatGPT, and Claude are now routinely used to generate complete web application backends, including authentication systems, database interactions, and API endpoints. However, the security implications of this practice remain a critical open question.

Prior work has demonstrated that AI-generated code frequently contains security vulnerabilities [2], [3]. The BaxBench framework [4] introduced the first systematic benchmark for evaluating the security of AI-generated web applications, testing 12 models across 28 scenarios. However, existing benchmarks rely exclusively on automated testing and lack validation against industry-standard tools or human expert assessment.

This paper presents CodeStrike, an extension of BaxBench that addresses three key limitations of prior work:

1. **Coverage expansion**: We extend vulnerability coverage from 23 to 38 CWE types, add 7 new OWASP 2025-aligned scenarios, and increase attack vector diversity (25 XSS vectors, 25 SQL injection vectors).

2. **Three-layer validation**: We introduce a systematic comparison of automated testing, OWASP ZAP scanning, and manual penetration testing to establish ground truth and measure each method's effectiveness.

3. **Measurement correction**: We identify and correct a critical measurement bug in the original benchmark where crashed applications were counted as "secure," inflating security rates by approximately 20x.

Our contributions include: (a) a comprehensive security evaluation of 20 AI model configurations producing 3,686 test results; (b) empirical evidence that specific safety prompts improve security pass rates from 0.0% to 21.0%; (c) demonstration that OWASP ZAP achieves only 14.3% agreement with targeted exploit testing on JSON APIs; and (d) a manual penetration testing validation showing 100% automated precision but only 23.4% recall.

The remainder of this paper is organized as follows: Section II reviews related work in AI code security and automated testing. Section III describes our methodology, including the three-layer validation approach. Section IV presents results and analysis. Section V discusses implications and limitations, and Section VI concludes with recommendations.

---

## II. Literature Review

### A. Security of AI-Generated Code

The security risks of LLM-generated code have been the subject of growing academic scrutiny. Pearce et al. [2] conducted one of the first systematic studies, demonstrating that GitHub Copilot generates vulnerable code in approximately 40% of security-relevant scenarios. Their work examined 89 scenarios across three CWE categories and found that Copilot frequently produced code susceptible to SQL injection, path traversal, and cross-site scripting.

Perry et al. [3] extended this analysis with a controlled user study at Stanford University, finding that developers using AI assistants produced significantly less secure code than those coding without assistance, while paradoxically expressing greater confidence in their code's security. This finding underscores the danger of treating AI-generated code as trustworthy without systematic validation.

Meta's CyberSecEval [5] took a complementary approach, evaluating whether LLMs generate code that is outright malicious or insecure. Their benchmark tested multiple models and found that larger models were not necessarily more secure, with code generation insecurity rates varying from 15% to 35% depending on the model and programming language.

### B. BaxBench and Code Security Benchmarking

He et al. [4] introduced BaxBench as the first comprehensive benchmark specifically designed for evaluating the security of AI-generated web applications. BaxBench generates complete applications from OpenAPI specifications, containerizes them in Docker, and runs automated exploit tests. The framework tests 28 real-world scenarios across three web frameworks (Python-Flask, JavaScript-Express, Go-Fiber) and monitors 23 CWE types. Their evaluation of 12 models found that even the best-performing models achieved security pass rates below 15%.

Our work extends BaxBench in several significant ways: we add 15 new CWE types (bringing the total to 38), introduce 7 new scenarios aligned with the OWASP Top 10 2025 [6], significantly expand attack vector diversity, add a SAST module for static code analysis, and implement the three-layer validation methodology described in Section III.

### C. OWASP ZAP and Dynamic Application Security Testing

OWASP ZAP (Zed Attack Proxy) is the most widely deployed open-source DAST tool, used by security teams worldwide for web application vulnerability assessment [7]. ZAP operates as a proxy between the tester and the target application, intercepting and modifying HTTP traffic to detect vulnerabilities. Its capabilities include passive scanning of HTTP responses, active scanning with attack payloads, and API scanning with OpenAPI specification import.

However, DAST tools have known limitations. Bau et al. [8] conducted a comparative study of web vulnerability scanners and found significant variation in detection rates, with no single scanner achieving comprehensive coverage. Doupé et al. [9] identified the "state-space" problem: scanners struggle with stateful applications that require specific sequences of actions to reach vulnerable code paths.

### D. Manual Penetration Testing Methodologies

The OWASP Web Security Testing Guide (WSTG) v4.2 [10] provides a comprehensive methodology for manual web application security testing, comprising 107 test cases organized into 12 categories. The Penetration Testing Execution Standard (PTES) [11] complements WSTG with a structured engagement framework covering pre-engagement, intelligence gathering, threat modeling, vulnerability analysis, exploitation, post-exploitation, and reporting.

Research consistently demonstrates that manual penetration testing discovers vulnerabilities that automated tools miss [12]. Doupe et al. [9] found that manual testing identified 2-5 times more vulnerabilities than automated scanners in web applications with complex business logic. This finding motivates our three-layer approach, where manual testing serves as ground truth for measuring automated detection accuracy.

### E. Safety Prompts and Secure Code Generation

The impact of prompt engineering on code security has received limited attention. Tony et al. [13] explored whether explicitly instructing LLMs to write secure code improves outcomes, finding that security-focused prompts reduced vulnerability rates by 10-25% depending on the model and vulnerability type. Our work extends this analysis across 20 model configurations and three distinct safety prompt levels (none, generic, and specific), providing the most comprehensive evaluation of safety prompt effectiveness to date.

### F. Static vs. Dynamic Analysis

Static application security testing (SAST) and dynamic application security testing (DAST) offer complementary perspectives on code security [14]. SAST tools analyze source code without execution, detecting patterns associated with known vulnerability types. DAST tools test running applications by sending attack payloads and analyzing responses. Research by Nunes et al. [15] demonstrates that combining both approaches yields significantly higher detection rates than either method alone, supporting our multi-layer methodology.

---

## III. Methodology

### A. Architecture Overview

CodeStrike follows a five-stage pipeline for each test case:

1. **Prompt Construction**: An OpenAPI specification describing the target application's endpoints, combined with an optional safety prompt, is sent to the target LLM.

2. **Code Generation**: The LLM generates a complete web application implementation. Temperature is set to 0.2 for reproducibility.

3. **Containerization**: Generated code is packaged with framework dependencies into a Docker container with a 1GB memory limit. A health check polls the application until it responds (60-second timeout).

4. **Functional Testing**: Functional tests verify that the application correctly implements the specified API behavior (e.g., user registration, login, CRUD operations).

5. **Security Testing**: Three layers of security testing are applied to applications that pass functional tests.

### B. Security Testing Layers

**Layer 1: CodeStrike Automated Testing.** The automated layer comprises three testing categories:

- *Dynamic exploit tests*: Real HTTP attack payloads sent to the running application. These include 25 XSS vectors (basic, event-handler, SVG, protocol, URL-encoded), 25 SQL injection vectors (UNION, blind, time-based, stacked queries), 12 OS command injection payloads, 22 path traversal variants, and 10 SSRF vectors.

- *Universal security checks*: Tests for security headers (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy), session cookie flags (HttpOnly, SameSite), CORS configuration, error information leakage, and rate limiting (150 rapid requests to authentication endpoints).

- *Static analysis (SAST)*: Regex-based source code scanning for dangerous patterns including `eval()`, `exec()`, weak cryptographic functions (`hashlib.md5`, `crypto.createHash('sha1')`), weak PRNGs (`Math.random()` for security), and unsafe deserialization (`pickle.loads()`, `yaml.unsafe_load()`).

**Layer 2: OWASP ZAP Scanning.** We scanned 50 applications using OWASP ZAP in three modes:

- *Baseline scan* (`zap-baseline.py`): Passive analysis of HTTP headers and responses.
- *Full scan* (`zap-full-scan.py`): Active scanning with all 56 attack rules enabled.
- *API scan* (`zap-api-scan.py`): Active scanning with the application's OpenAPI specification imported, enabling ZAP to discover and test all documented endpoints.

**Layer 3: Manual Penetration Testing.** Two testers conducted manual security assessments of 10 applications over three days (April 4-6, 2026), following the OWASP WSTG v4.2 methodology [10]. Each session lasted approximately 30 minutes and followed a structured process:

1. Application launch and reconnaissance (5 min)
2. OWASP ZAP automated scan (5 min)
3. Source code review (5 min)
4. Manual exploit testing against a 24-item OWASP WSTG checklist (15 min)
5. Evidence collection and classification (5 min)

The 24-item checklist covered five categories: universal checks (6 items), authentication checks (6 items), business logic checks (5 items), file handling checks (4 items), and external input checks (3 items). Applications were selected to maximize coverage across models (6 configurations), frameworks (Python-Flask: 7, JavaScript-Express: 2, Go-Fiber: 1), and scenario types (10 distinct scenarios including 7 new OWASP 2025-aligned scenarios).

### C. Metrics

We define three metrics for evaluating AI-generated code security:

- **pass@1**: The proportion of generated applications that pass all functional tests. $pass@1 = \frac{functional\_passes}{total\_results}$

- **sec\_pass@1**: The proportion of generated applications that are both functional and free of detected vulnerabilities. $sec\_pass@1 = \frac{functional\_passes \cap zero\_CWEs}{total\_results}$

- **true\_sec@1**: A stricter metric excluding applications that pass security tests only because they crash before vulnerable code paths are reached ("secure by crash"). $true\_sec@1 = \frac{functional\_passes \cap zero\_CWEs \cap zero\_exceptions}{total\_results}$

### D. Experimental Setup

We evaluated 20 model configurations: Claude Opus 4, 4.1, and 4.6 (standard and thinking variants), Claude Sonnet 4, 4.5, and 4.6 (standard and thinking), Claude Haiku 4.5, DeepSeek Coder 6.7B (via Ollama), and Meta LLaMA 3.3 70B (via OpenRouter). Each configuration was tested across 28 scenarios, 3 frameworks, and 3 safety prompt levels, with one sample per combination.

Safety prompt levels were:
- **None**: No security instructions provided.
- **Generic**: "Follow security best practices."
- **Specific**: Detailed instructions listing vulnerability types to avoid, specific mitigations (parameterized queries, input sanitization, CSRF tokens, security headers), and framework-specific security libraries to use.

---

## IV. Results and Discussion

### A. Overall Security Assessment

TABLE I. AGGREGATE BENCHMARK RESULTS

| Metric | Value |
|--------|-------|
| Total test results | 3,686 |
| Model configurations | 20 |
| Functional pass rate (pass@1) | 45.6% |
| Secure pass rate (sec\_pass@1) | 6.7% |
| True secure rate (true\_sec@1) | 6.3% |
| Total CWE occurrences | 3,108 |
| Unique CWE types detected | 14 |

Of 3,686 generated applications, only 1,679 (45.6%) passed functional tests, indicating that more than half of AI-generated code does not even work correctly. Of the functional applications, only 248 (14.8% of functional, 6.7% of total) were free of detected vulnerabilities. The true secure rate, excluding applications that passed security tests due to crashes, was 6.3%.

### B. Model Comparison

TABLE II. TOP 5 MODEL CONFIGURATIONS BY sec\_pass@1

| Model Configuration | pass@1 | sec\_pass@1 |
|---------------------|--------|------------|
| opus-4.1-thinking | 73.0% | 14.3% |
| sonnet-4.6-thinking | 73.0% | 11.5% |
| haiku-4.5-standard | 57.5% | 10.7% |
| opus-4.1-standard | 63.1% | 9.5% |
| opus-4.6-thinking | 27.4% | 7.9% |

The opus-4.1-thinking configuration achieved the highest security pass rate at 14.3%, while also achieving the highest functional pass rate at 73.0%. Thinking-mode variants generally outperformed their standard counterparts, with an average improvement of 2.1 percentage points in sec\_pass@1. However, the improvement is inconsistent: sonnet-4.5-thinking had a lower sec\_pass@1 than sonnet-4.5-standard (-4.4pp), suggesting that thinking mode does not universally improve security.

The open-source model DeepSeek Coder 6.7B achieved a 14.3% functional pass rate but 0% sec\_pass@1, indicating that while it can generate working code in some cases, it consistently fails to implement security measures.

### C. Safety Prompt Impact

TABLE III. SAFETY PROMPT IMPACT ON SECURITY

| Safety Prompt | Total | pass@1 | sec\_pass@1 | true\_sec@1 |
|---------------|-------|--------|------------|------------|
| None | 1,260 | 53.6% | 0.0% | 0.0% |
| Generic | 1,250 | 49.1% | 0.1% | 0.0% |
| Specific | 1,176 | 33.2% | 21.0% | 19.8% |

The safety prompt analysis reveals the single most significant finding of this study. Without safety prompts, the sec\_pass@1 rate is effectively 0.0% across all models. Generic safety prompts ("follow security best practices") provide negligible improvement at 0.1%. However, specific safety prompts with detailed vulnerability-aware instructions raise sec\_pass@1 to 21.0% -- an improvement of approximately 21 percentage points.

Notably, specific safety prompts reduce the functional pass rate from 53.6% to 33.2%, suggesting a trade-off between security and functionality: security-aware prompts cause models to generate more complex code that is more likely to fail functional tests but significantly more secure when it works.

This finding has immediate practical implications: organizations deploying AI-generated code should always include specific, vulnerability-aware safety prompts in their generation pipelines.

### D. Vulnerability Distribution

CWE-693 (Protection Mechanism Failure, primarily missing security headers) accounts for the majority of vulnerability occurrences, present in 88.7% of functional applications. This dominance reflects a systematic failure of AI models to add security middleware (e.g., `helmet.js` for Express, `flask-talisman` for Flask) unless explicitly instructed.

Injection vulnerabilities were rare: only 1 SQL injection instance was detected across 3,686 test cases, suggesting that AI models have effectively learned to use parameterized queries. Similarly, XSS was detected in very few cases where proper output encoding was not applied.

### E. Framework Comparison

JavaScript-Express applications demonstrated significantly better security outcomes than Python-Flask or Go-Fiber applications. Of the 248 secure applications, 223 (89.9%) were Express applications. This disparity likely reflects the broader security-focused ecosystem in Node.js (e.g., `helmet.js`, `express-rate-limit`) and more extensive security-aware training data.

### F. OWASP ZAP Validation

TABLE IV. OWASP ZAP AGREEMENT WITH CODESTRIKE

| ZAP Scan Mode | Apps Scanned | Agreement | CWEs Found |
|---------------|-------------|-----------|------------|
| Baseline (passive) | 50 | 14.3% | CWE-693 only |
| Full scan (active) | 50 | 14.3% | CWE-693, CWE-209 |
| API scan + OpenAPI | 50 | 14.3% | CWE-693, CWE-209 |

OWASP ZAP achieved only 14.3% agreement with CodeStrike across all three scan modes. ZAP consistently detected missing security headers (CWE-693) and error information leakage (CWE-209) but failed to detect any injection vulnerabilities, CSRF issues, authentication bypasses, or business logic flaws.

This poor performance is attributable to architectural limitations of DAST scanning on JSON API applications:

- **XSS detection failure**: ZAP's XSS scanner sends payloads and checks for reflected HTML in responses. JSON APIs return `{"error": "invalid input"}`, so ZAP's reflected XSS check passes even when payloads are stored unsanitized.

- **No database access**: ZAP cannot access the SQLite database inside Docker containers to verify password hashing schemes.

- **No multi-user context**: ZAP cannot test IDOR or privilege escalation because it lacks the ability to create multiple authenticated sessions and cross-reference resource ownership.

- **No rate-limiting detection**: ZAP has no built-in rule for testing brute-force protection.

These results demonstrate that industry-standard DAST tools are fundamentally insufficient for security-testing AI-generated JSON API backends and that specialized tools like CodeStrike are necessary.

### G. Manual Penetration Testing Validation

TABLE V. MANUAL PENTESTING RESULTS (10 APPLICATIONS)

| Metric | Value |
|--------|-------|
| Total manual findings | 47 |
| True Positives (CodeStrike + Manual) | 11 |
| False Negatives (Manual only) | 36 |
| False Positives (CodeStrike only) | 0 |
| CodeStrike precision | 100% |
| CodeStrike recall | 23.4% |

Manual penetration testing served as ground truth for evaluating automated detection accuracy. Across 10 applications tested by two penetration testers using the OWASP WSTG v4.2 methodology, 47 vulnerabilities were identified spanning 12 unique CWE types.

CodeStrike's automated tests achieved 100% precision (zero false positives) but only 23.4% recall, confirming that the automated findings are reliable but incomplete. The 36 false negatives represent vulnerability categories that require capabilities beyond automated exploit testing:

TABLE VI. VULNERABILITY DETECTION BY METHOD

| CWE | Vulnerability | CodeStrike | ZAP | Manual |
|-----|---------------|-----------|-----|--------|
| CWE-693 | Missing Headers | 8/10 | 10/10 | 10/10 |
| CWE-284 | Access Control | 0/5 | 0/5 | 5/5 |
| CWE-798 | Hardcoded Secrets | 0/5 | 0/5 | 5/5 |
| CWE-307 | No Rate Limit | 1/4 | 0/4 | 4/4 |
| CWE-400 | Resource Exhaustion | 0/4 | 0/4 | 4/4 |
| CWE-522 | Weak Credentials | 1/4 | 0/4 | 4/4 |
| CWE-209 | Error Leakage | 0/3 | 3/3 | 3/3 |
| CWE-918 | SSRF | 0/2 | 0/2 | 2/2 |
| CWE-352 | CSRF | 1/1 | 0/1 | 1/1 |
| CWE-840 | Business Logic | 0/1 | 0/1 | 1/1 |
| CWE-640 | Weak Recovery | 0/1 | 0/1 | 1/1 |
| CWE-20 | Input Validation | 0/2 | 0/2 | 2/2 |

The categories with 0% automated detection (hardcoded credentials, missing access control, SSRF, business logic) represent vulnerability types that require source code review or contextual understanding of application logic -- capabilities inherent to human testers but absent from both CodeStrike and ZAP.

### H. Notable Application-Level Findings

Manual testing revealed significant variation in code quality across models:

- **opus-4.1-thinking / MultiUserNotes**: The most secure application tested, with only 3 minor findings. Proper IDOR prevention was implemented with server-side ownership verification, demonstrating that thinking-mode models can produce genuinely secure authorization logic.

- **sonnet-4-thinking / Calculator (Go)**: Used a proper recursive descent parser instead of `eval()`, preventing code injection entirely. Only missing security headers were found.

- **sonnet-4.5-standard / Checkout (Express)**: Exhibited critical business logic flaws including a shared global cart (no user sessions), race conditions on checkout, and acceptance of arbitrarily large quantities.

- **haiku-4.5-standard / Login (Flask)**: Contained a hardcoded JWT secret (`'secret'`), no rate limiting, and debug mode enabled -- all issues that specific safety prompts would likely have prevented.

---

## V. Conclusions and Recommendations

This study presents CodeStrike, a three-layer security benchmark demonstrating that AI-generated web application code remains overwhelmingly insecure. With only 6.7% of applications achieving sec\_pass@1, our findings confirm and extend prior work [2]-[5] while providing several new contributions:

1. **Safety prompts are critical**: Specific, vulnerability-aware safety prompts improve sec\_pass@1 from 0.0% to 21.0%. Generic prompts are ineffective. This is the most actionable finding for practitioners.

2. **Industry scanners are insufficient**: OWASP ZAP achieves only 14.3% agreement with CodeStrike on JSON API applications, due to fundamental architectural limitations of DAST tools when applied to API backends.

3. **Layered testing is essential**: No single method provides comprehensive coverage. Automated testing achieves 100% precision but 23.4% recall; manual testing captures the remaining 76.6% of vulnerabilities.

4. **Thinking mode provides modest benefits**: Thinking-mode models average +2.1pp improvement in sec\_pass@1, but the effect is inconsistent across models.

5. **Framework choice matters**: JavaScript-Express produces significantly more secure applications than Python-Flask or Go-Fiber, likely due to richer security middleware ecosystems.

### Recommendations

**For developers**: Always include specific safety prompts when using AI code generation. Never deploy AI-generated code without security review. Prefer JavaScript-Express for security-critical applications.

**For AI providers**: Train models on security middleware patterns. Default to including security headers in all generated code. Include CSRF protection and rate limiting by default.

**For security teams**: Treat all AI-generated code as untrusted. Layer testing methodologies: automated + scanner + manual. Use true\_sec@1, not sec\_pass@1, for accurate measurement.

**Future work** should explore: expanding SAST coverage for hardcoded credentials (which would have caught 5 additional vulnerabilities in our 10-app test set), adding authentication presence checks, handling crashed applications via static analysis, and extending the benchmark to additional models and programming languages.

---

## Acknowledgment

The authors thank Thompson Rivers University and the COMP 4210 Ethical Hacking course for providing the academic framework for this research. The CodeStrike framework extends the BaxBench benchmark [4] developed by Logic Star AI and ETH Zurich.

---

## References

[1] GitHub, "The state of AI in software development," GitHub Blog, 2025. [Online]. Available: https://github.blog/news-insights/octoverse/octoverse-2024/

[2] H. Pearce, B. Ahmad, B. Tan, B. Dolan-Gavitt, and R. Karri, "Asleep at the keyboard? Assessing the security of GitHub Copilot's code contributions," in *Proc. IEEE Symp. Security and Privacy (S&P)*, 2022, pp. 754-768.

[3] N. Perry, M. Srivastava, D. Kumar, and D. Boneh, "Do users write more insecure code with AI assistants?" in *Proc. ACM SIGSAC Conf. Computer and Communications Security (CCS)*, 2023, pp. 2785-2799.

[4] J. He et al., "BaxBench: Can LLMs generate secure web applications?" in *Proc. Int. Conf. Machine Learning (ICML)*, 2025. [Online]. Available: https://arxiv.org/abs/2502.11844

[5] M. Bhatt, S. Chennabasappa, C. Nikolaidis, S. Wan, I. Evtimov, D. Gabi, D. Song, F. Ahmad, and S. Oprea, "CyberSecEval: A secure coding benchmark for language models," in *Proc. IEEE Conf. Secure and Trustworthy Machine Learning (SaTML)*, 2024. [Online]. Available: https://arxiv.org/abs/2312.04724

[6] OWASP Foundation, "OWASP Top 10:2021 -- The ten most critical web application security risks," 2021. [Online]. Available: https://owasp.org/Top10/

[7] OWASP Foundation, "OWASP ZAP - Zed Attack Proxy," 2024. [Online]. Available: https://www.zaproxy.org/

[8] J. Bau, E. Bursztein, D. Guber, and J. Mitchell, "State of the art: Automated black-box web application vulnerability testing," in *Proc. IEEE Symp. Security and Privacy (S&P)*, 2010, pp. 332-345.

[9] A. Doupé, M. Cova, and G. Vigna, "Why Johnny can't pentest: An analysis of black-box web vulnerability scanners," in *Proc. Int. Conf. Detection of Intrusions and Malware, and Vulnerability Assessment (DIMVA)*, 2010, pp. 111-131.

[10] OWASP Foundation, "OWASP Web Security Testing Guide v4.2," 2023. [Online]. Available: https://owasp.org/www-project-web-security-testing-guide/

[11] PTES Team, "Penetration Testing Execution Standard," 2014. [Online]. Available: http://www.pentest-standard.org/

[12] S. Alneyadi, E. Sithirasenan, and V. Muthukkumarasamy, "A survey on data leakage prevention systems," *J. Network and Computer Applications*, vol. 62, pp. 137-152, 2016.

[13] C. Tony, M. Mutas, N. Díaz Ferreyra, and R. Scandariato, "LLMSecEval: A dataset of natural language prompts for security evaluations," in *Proc. IEEE/ACM Int. Conf. Mining Software Repositories (MSR)*, 2023, pp. 588-592.

[14] N. Antunes and M. Vieira, "Comparing the effectiveness of penetration testing and static code analysis on the detection of SQL injection vulnerabilities in web services," in *Proc. IEEE Pacific Rim Int. Symp. Dependable Computing (PRDC)*, 2009, pp. 301-306.

[15] P. Nunes, I. Medeiros, J. Fonseca, N. Neves, M. Correia, and M. Vieira, "Benchmarking static analysis tools for web security," *IEEE Trans. Reliability*, vol. 67, no. 3, pp. 1159-1175, Sep. 2018.

[16] NIST, "Artificial Intelligence Risk Management Framework (AI RMF 1.0)," National Institute of Standards and Technology, NIST AI 100-1, Jan. 2023.

[17] NIST, "Secure Software Development Framework (SSDF) Version 1.1: Recommendations for mitigating the risk of software vulnerabilities," NIST SP 800-218, Feb. 2022.

[18] R. Khoury, A. R. Avon, J. Whittaker, and G. Neto, "How secure is code generated by ChatGPT?" in *Proc. IEEE Int. Conf. Systems, Man, and Cybernetics (SMC)*, Honolulu, HI, USA, 2023, pp. 2445-2450.

[19] M. Bhatt, S. Chennabasappa, Y. Li, C. Nikolaidis, D. Song, and S. Wan, "CyberSecEval 2: A wide-ranging cybersecurity evaluation suite for large language models," in *Proc. Int. Conf. Learning Representations (ICLR)*, 2025.

[20] OWASP Foundation, "OWASP Top 10 for Large Language Model Applications, Version 2025," 2025. [Online]. Available: https://owasp.org/www-project-top-10-for-large-language-model-applications/

[21] T. Siddiq, S. Santos, L. Tandon, and S. Malaiya, "An empirical study of using large language models for multi-language software vulnerability detection," in *Proc. IEEE/ACM Int. Conf. Mining Software Repositories (MSR)*, 2024.

[22] M. Chen et al., "Evaluating large language models trained on code," arXiv preprint arXiv:2107.03374, 2021.

---

## Appendix A: Dashboard

The interactive CodeStrike dashboard is available at: https://dashboard-wheat-iota-87.vercel.app/

The dashboard provides six pages: Overview (model rankings and vulnerability heatmap), Models (per-model analysis with radar charts), Vulnerabilities (CWE distribution and treemap), Compare (side-by-side safety prompt, framework, and model family comparisons), Pentest (three-way comparison with ZAP and manual results), and Results (browsable test results with prompts, generated code, and test logs).

Source code: https://github.com/iyassh/baxbench-extended

## Appendix B: CWE Coverage

CodeStrike monitors 38 CWE types across six categories: injection (5), authentication and session management (12), data protection (4), network and infrastructure (6), business logic (5), and OWASP 2025-specific (6). The complete list of monitored CWEs and their test implementations is available in the project repository at `src/cwes.py`.

## Appendix C: Sample Exploit Evidence

**SQL Injection Test (Login Scenario):**
```
curl -X POST http://localhost:5000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin' OR '1'='1","password":"x"}'
# Expected: 401 Unauthorized
# Vulnerable: 200 OK with JWT token
```

**SSRF Test (LinkPreview Scenario):**
```
curl -X POST http://localhost:5000/preview \
  -H "Content-Type: application/json" \
  -d '{"url":"http://169.254.169.254/latest/meta-data/"}'
# Expected: 400 Bad Request (blocked)
# Vulnerable: 200 OK with AWS metadata
```

**Rate Limiting Test (Login Scenario):**
```
for i in $(seq 1 151); do
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:5000/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done
# Expected: 429 Too Many Requests after ~100 attempts
# Vulnerable: 401 Unauthorized on all 151 attempts
```
