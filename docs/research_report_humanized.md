CodeStrike: A Three-Layer Security Benchmark for AI-Generated Web Applications

Deepansh Sharma
Dept. of Computing Science
Thompson Rivers University
Kamloops, Canada
deepansh.sharma@mytru.ca

Yaash Iyassu
Dept. of Computing Science
Thompson Rivers University
Kamloops, Canada
yaash.iyassu@mytru.ca

Ravinder Singh
Dept. of Computing Science
Thompson Rivers University
Kamloops, Canada
ravinder.singh@mytru.ca

Vansh Patel
Dept. of Computing Science
Thompson Rivers University
Kamloops, Canada
vansh.patel@mytru.ca

## Abstract
Large language models are rapidly becoming a standard tool for generating web application source code. Despite their widespread use, the security posture of the applications they output has not been fully explored. This paper introduces CodeStrike, a security benchmark designed to evaluate AI-generated web apps using automated exploit testing, OWASP ZAP scanning, and manual penetration testing. We tested 20 LLM configurations across 28 scenarios, targeting 3 web frameworks with varying prompt constraints, yielding 3,686 unique application tests. The data indicates that under 7% of these AI-generated apps successfully pass both functional requirements and baseline security evaluations. A notable takeaway from our testing was the impact of prompt engineering: specific safety instructions increased the secure pass rate to 21.0%, whereas generic instructions (e.g., "write secure code") showed marginal to zero effect. Furthermore, we observed that OWASP ZAP, a widely used dynamic scanner, matched our automated and manual findings in only 14.3% of cases when applied to JSON APIs. Manual testing on a sample of 10 applications revealed 47 distinct vulnerabilities; CodeStrike's internal tests caught 11 of these with complete accuracy, achieving 100% precision but only 23.4% recall. These results suggest that single-layered vulnerability scanning is insufficient for verifying LLM-generated code and that multi-tiered validation is required.

## Keywords
AI code security, large language models, penetration testing, OWASP, vulnerability detection, security benchmark

## I. INTRODUCTION
AI coding assistants have seen explosive adoption in software development. Recent surveys suggest that almost all developers have interacted with AI tools for code generation in some capacity [1]. Major models like GitHub Copilot, ChatGPT, and Claude are routinely used to produce functional web backends, establishing authentication logic, database interactions, and API routes from short prompts. However, the convenience of rapid code delivery introduces significant questions regarding the inherent security of the synthesized code.

Existing literature largely concludes that the baseline security of LLM-generated code is poor. Pearce et al. found that tools like Copilot produce insecure output in approximately 40% of scenarios evaluated in their study [2]. A subsequent experiment by Perry et al. observed that human developers utilizing AI assistants often produced code with more vulnerabilities compared to unassisted peers, while paradoxically reporting higher confidence in the security of their implementations [3]. 

BaxBench [4] was introduced at ETH Zurich as an early attempt to systematically benchmark the security of AI-written backends. It operated by generating full applications from OpenAPI specs and executing them dynamically in isolated Docker containers, checking against 23 vulnerabilities. While effective as an automated framework, it lacked external validation to measure false positives or negatives and overlooked some common real-world web exploitation methods.

Our project, CodeStrike, builds on the BaxBench architecture to address these limitations. We expanded the vulnerability coverage to 38 CWE types and integrated 7 new scenarios aligned with recent OWASP standards. More importantly, we introduced a three-layer validation process—incorporating OWASP ZAP and manual penetration testing—to evaluate the efficacy of the automated tests themselves. During our evaluation, we also corrected a measurement flaw in the original benchmark that incorrectly labeled applications crashing under load as "secure," an issue that artificially inflated secure pass rates by an estimated factor of twenty.

## II. LITERATURE REVIEW

### A. Security of AI-Generated Code
Academic interest in the security dimensions of LLM code generation has expanded significantly since 2021. Pearce et al. [2] conducted early systematic research on GitHub Copilot using 89 scenario tests, identifying prevalent issues like SQL injection, cross-site scripting (XSS), and path traversal. Their S&P 2022 publication provided the groundwork for modern LLM code analysis. 

Rather than testing models statically, Perry et al. [3] observed developer behavioral patterns when using AI. Published at ACM CCS 2023, their findings highlighted that AI assistance can degrade overall code security, reinforcing the need to rigorously evaluate the models behind these tools. Meta's CyberSecEval [5] later measured insecurity rates ranging from 15% to 35% across various base models, while Khoury et al. [18] documented comparable vulnerability injection patterns in ChatGPT outputs.

### B. BaxBench and Benchmarking Frameworks
Vero et al. [4] presented BaxBench at ICML 2025, defining an end-to-end testing standard for web deployments. By compiling and running LLM code directly in Docker, BaxBench moved beyond static snippet analysis. CodeStrike inherits this execution model but broadens the scenario scope and relies on manual verification layers to confirm the detection metrics.

### C. OWASP ZAP and Automated Scanning
OWASP ZAP [7] remains a common standard for automated web vulnerability discovery. It applies both passive header inspection and active payload fuzzing. However, limitations in DAST (Dynamic Application Security Testing) tools are well-documented. Bau et al. [8] showed in their 2010 S&P analysis that detection rates vary widely and rely heavily on the tool's ability to crawl application paths. Doupe et al. [9] observed that scanners struggle to navigate applications requiring complex state sequences. These constraints are particularly noticeable when analyzing decoupled JSON APIs, as seen in our results.

### D. Manual Penetration Testing
Manual testing, as defined by frameworks like the PTES [11] and OWASP WSTG [10], consistently uncovers logic flaws that automation overlooks. Prior research shows human testers achieve higher detection rates for applications with custom business logic. As a result, we incorporated structured manual testing as the ground-truth standard for CodeStrike.

### E. Static vs. Dynamic Analysis
The comparative effectiveness of SAST versus DAST is covered extensively in cybersecurity literature. Antunes and Vieira [14] found the approaches to be complementary when targeting SQL injection, while Nunes et al. [15] similarly advocated for composite testing methodologies. These findings mirror recommendations from frameworks like the NIST SSDF [17], guiding our decision to employ a hybridized testing model.

## III. METHODOLOGY

### A. Testing Pipeline
The CodeStrike assessment pipeline comprises five stages. We supply an OpenAPI specification alongside defined safety instructions to the target LLMs, enforced at a temperature of 0.2 to limit hallucinatory outputs. The resulting application source code is containerized in a 1GB Docker instance containing necessary runtime environments. Functional tests are subsequently run to ensure the code operates correctly (handling registrations, routes, and responses). Applications meeting the functional criteria then undergo security validation testing.

### B. Layer 1: Automated Exploit Testing
The automated subsystem handles active exploitation and static review. Dynamic payloads include 25 specific XSS strings, 25 SQL injection variants, 12 OS command injections, 22 path traversals, and 10 SSRF vectors. The suite also tests for universal security misconfigurations, such as header definitions, CORS implementations, and brute-force mitigations. Static checks evaluate the presence of high-risk function calls, such as unsafe deserialization methods or weak cryptographic libraries.

### C. Layer 2: OWASP ZAP Scanning
ZAP was executed against a subset of 50 functional applications using three configurations: passive baseline scanning, comprehensive active scanning using 56 active rules, and an API scan mode fed purely by the application's OpenAPI manifest.

### D. Layer 3: Manual Penetration Testing
A manual assessment was performed by two testers over three days on a diverse sample of 10 generated applications. The process followed OWASP WSTG v4.2 methodology, allocating approximately 30 minutes per application. The tests included reconnaissance, static reviews, ZAP integration, and targeted manual exploitation targeting JWT manipulation, SSRF, input validation, and business logic flaws. Applications explicitly constructed without safety prompting were chosen to guarantee a diverse vulnerability surface.

### E. Metrics
We define three core reporting metrics. `pass@1` represents the percentage of applications meeting all functional tests. `sec_pass@1` is the subset of functional applications that completely avoid triggering security alarms. `true_sec@1` serves as a corrected metric resolving applications that crashed entirely during security testing rather than naturally resisting exploits.

### F. Models and Configurations
Testing was distributed across 20 distinct LLM variants, primarily sourced from the Claude 4 iteration family (Opus, Sonnet, and Haiku), along with isolated tests utilizing DeepSeek Coder 6.7B and LLaMA 3.3. Scenarios were executed across three target frameworks under three distinct safety prompt conditions to measure relative security consciousness.

## IV. RESULTS AND DISCUSSION

### A. The Security Funnel
Out of 3,686 tests, 1,679 (45.6%) instances produced functioning applications meeting basic route expectations. However, only 248 of these (14.8% of functional code, 6.7% of total tests) were free from detected vulnerabilities. After adjusting for applications that simply crashed when targeted (the `true_sec@1` metric), the actual security rate stabilized at 6.3%.

TABLE I. AGGREGATE BENCHMARK RESULTS
Metric | Value
Total test results | 3,686
Model configurations | 20
Functional pass rate (pass@1) | 45.6%
Secure pass rate (sec_pass@1) | 6.7%
True secure rate (true_sec@1) | 6.3%
Total CWE occurrences | 3,108

### B. Model Comparison
The `opus-4.1-thinking` model returned the highest overall performance, yielding a 14.3% `sec_pass@1` alongside a 73.0% functional pass rate. Models operating with extended reasoning paths ("thinking" modes) frequently exhibited better security profiles, though variances existed (e.g., standard `sonnet-4.5` outperforming its reasoning variant). Open-weights models like DeepSeek Coder 6.7B processed the functional directives moderately well (14.3%) but failed to generate any applications that passed baseline security testing natively.

TABLE II. TOP 5 MODEL CONFIGURATIONS BY sec_pass@1
Model | pass@1 | sec_pass@1
opus-4.1-thinking | 73.0% | 14.3%
sonnet-4.6-thinking | 73.0% | 11.5%
haiku-4.5-standard | 57.5% | 10.7%
opus-4.1-standard | 63.1% | 9.5%
opus-4.6-thinking | 27.4% | 7.9%

### C. Safety Prompts
Tests conducted without restrictive safety instructions resulted in a 0.0% security pass rate. Providing broad, non-specific directives (e.g., "ensure the application follows security best practices") only increased success to 0.1%. Contrastingly, highly specific instructions defining required mitigations (e.g., demanding CSRF tokens or parameterized queries) elevated the secure pass rate to 21.0%. Functional capability, however, diminished to 33.2% under restrictive prompts, likely due to the structural complexity of generating extensive middleware loops dynamically. 

TABLE III. SAFETY PROMPT IMPACT ON SECURITY
Safety Prompt | Total | pass@1 | sec_pass@1
None | 1,260 | 53.6% | 0.0%
Generic | 1,250 | 49.1% | 0.1%
Specific | 1,176 | 33.2% | 21.0%

### D. Vulnerability Patterns
Missing HTTP security headers (CWE-693) heavily skewed the defect rate, observed in over 88% of applications. Without manual instruction, large language models typically omit necessary middleware wrappers across all evaluated frameworks. Notably, hardcoded SQL injection vulnerabilities were exceedingly rare (1 instance in 3,686 runs), showing a shift in modern LLM training towards standardizing parameterized object relational mapping. Express-based applications formed almost 90% of the secure application pool, likely benefiting from robust open-source ecosystem defaults relative to the specific tests executed on Go-Fiber or Python Flask.

### E. Limitations of Automated Scanners
OWASP ZAP demonstrated an agreement rate of only 14.3% with the targeted internal benchmarks. While ZAP localized instances of header misconfiguration and generic error leakage, it systematically overlooked CSRF omissions and logical workflow gaps natively found by CodeStrike custom payloads. This underscores the architectural weaknesses in applying general-purpose web fuzzers to stateless, token-managed REST APIs running within self-contained orchestrations.

TABLE IV. OWASP ZAP AGREEMENT WITH CODESTRIKE
ZAP Mode | Apps | Agreement | CWEs Found
Baseline (passive) | 50 | 14.3% | CWE-693 only
Full scan (active) | 50 | 14.3% | CWE-693, CWE-209
API scan + OpenAPI | 50 | 14.3% | CWE-693, CWE-209

### F. Manual Testing
The manual assessment of 10 applications uncovered an additional 36 vulnerabilities across logic definitions, access control schemas, and SSRF points unavailable to automated execution. Where CodeStrike identified 11 vulnerabilities (verified correctly without false positives), the human evaluators achieved absolute coverage. The precision of automated tools remains high, but overall detection recall heavily restricts their utility as singular safety gates.

TABLE V. MANUAL PENTESTING RESULTS (10 APPLICATIONS)
Metric | Value
Total manual findings | 47
True Positives (confirmed by both) | 11
False Negatives (manual only) | 36
False Positives | 0
CodeStrike precision | 100%
CodeStrike recall | 23.4%

### G. Synthesis
The detection discrepancy confirms that no automated layer guarantees security mapping alone. Tools like ZAP remain constrained to observable interface borders. In contrast, CodeStrike's dynamic and static validations extend inwards to the database logic but inevitably fall short against complex semantic flaws that human pentesters systematically target.

### H. Observations on Secure Model Generation
Despite the low overall validation rates, evidence indicates LLMs can successfully handle advanced defensive constructs. The `opus-4.1-thinking` model reliably produced authorization gates mapping user ownership to requested resources, resolving standard IDOR vectors. Similarly, syntactic parsing logic avoiding naive string execution was generated autonomously by `sonnet` variants, suggesting the latent defensive logic exists within the parameter space when prompted to structure software defensively.

## V. CONCLUSIONS AND RECOMMENDATIONS
The evaluation of 3,686 AI-generated backends highlights several operational factors regarding LLM security compliance:
1. Vague security directives are inadequate. Achieving secure output demands granular contextual prompting emphasizing known application patterns.
2. Market-standard web scanners exhibit extreme coverage limitations when assessing AI-generated backend APIs independently.
3. Automated tooling possesses high detection precision but insufficient recall for comprehensive auditing.
4. Reasoning augmentation layers ("thinking" processes) within LLMs improve average robustness but do not replace structural validation practices.
5. Ecosystem-specific implementations heavily dictate generated vulnerability surfaces out-of-the-box.

We propose continued research into extending static checks directly into model runtime validations (e.g., evaluating secret leakage in real-time) and expanding comprehensive framework analysis horizontally across different web technology stacks. The complete metric corpus and validation data are accessible for external review.

## ACKNOWLEDGMENT
The authors thank Thompson Rivers University and the COMP 4210 Ethical Hacking course for supporting this research. CodeStrike extends the BaxBench framework [4] developed by Vero et al. at ETH Zurich.

## REFERENCES
[1] GitHub, "Octoverse 2024: AI leads Python to top language as the number of global developers surges," GitHub Blog, Oct. 2024. [Online].
[2] H. Pearce, B. Ahmad, B. Tan, B. Dolan-Gavitt, and R. Karri, "Asleep at the keyboard? Assessing the security of GitHub Copilot's code contributions," in Proc. IEEE Symp. Security and Privacy (S&P), May 2022.
[3] N. Perry, M. Srivastava, D. Kumar, and D. Boneh, "Do users write more insecure code with AI assistants?" in Proc. ACM SIGSAC Conf. Computer and Communications Security (CCS), Nov. 2023.
[4] M. Vero, N. Mundler, V. Chibotaru, V. Raychev, M. Baader, N. Jovanovic, J. He, and M. Vechev, "BaxBench: Can LLMs generate correct and secure backends?" in Proc. Int. Conf. Machine Learning (ICML), 2025.
[5] M. Bhatt et al., "Purple Llama CyberSecEval: A secure coding benchmark for language models," arXiv preprint, Dec. 2023.
[6] OWASP Foundation, "OWASP Top 10:2021 – The ten most critical web application security risks," 2021.
[7] OWASP Foundation, "OWASP ZAP – Zed Attack Proxy." [Online]. Available: https://www.zaproxy.org/
[8] J. Bau, E. Bursztein, D. Gupta, and J. Mitchell, "State of the art: Automated black-box web application vulnerability testing," in Proc. IEEE S&P, May 2010.
[9] A. Doupé, M. Cova, and G. Vigna, "Why Johnny can't pentest: An analysis of black-box web vulnerability scanners," in Proc. DIMVA, Jul. 2010.
[10] OWASP Foundation, "OWASP Web Security Testing Guide v4.2," 2023.
[11] PTES Team, "Penetration Testing Execution Standard."
[12] N. Antunes and M. Vieira, "Comparing the effectiveness of penetration testing and static code analysis on the detection of SQL injection," in Proc. IEEE PRDC, Nov. 2009.
[13] C. Tony, M. Mutas, N. Díaz Ferreyra, and R. Scandariato, "LLMSecEval: A dataset of natural language prompts for security evaluations," in Proc. IEEE/ACM MSR, May 2023.
[14] P. Nunes, I. Medeiros, J. Fonseca, N. Neves, M. Correia, and M. Vieira, "Benchmarking static analysis tools for web security," IEEE Trans. Reliability, Sep. 2018.
[15] NIST, "Artificial Intelligence Risk Management Framework," Jan. 2023.
[16] NIST, "Secure Software Development Framework (SSDF) Version 1.1," Feb. 2022.
[17] R. Khoury, A. R. Avon, J. Whittaker, and G. Neto, "How secure is code generated by ChatGPT?" in Proc. IEEE SMC, Oct. 2023.
[18] M. Bhatt et al., "CyberSecEval 2: A wide-ranging cybersecurity evaluation suite for large language models," arXiv preprint, Apr. 2024.
[19] OWASP Foundation, "OWASP Top 10 for Large Language Model Applications," Version 2.0, 2025.
[20] M. Chen et al., "Evaluating large language models trained on code," Jul. 2021.
