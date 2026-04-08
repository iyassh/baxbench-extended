# CodeStrike Extended - Future Work Roadmap

## Current Coverage Summary

| Metric | Current | Target |
|--------|---------|--------|
| **CWEs** | 23 | ~43 |
| **Scenarios** | 28 | ~43 |
| **OWASP Web Top 10** | 1 full, 5 partial, 4 missing | Full coverage |
| **OWASP API Top 10** | 1 full, 3 partial, 6 missing | Full coverage |

---

## 1. Missing CWEs (~20 to add)

### Priority 1 - Critical Gaps

| CWE | Name | OWASP Category | Why |
|-----|------|----------------|-----|
| CWE-918 | SSRF (Server-Side Request Forgery) | A10 | Entire OWASP category uncovered |
| CWE-639 | IDOR (Authorization Bypass via User-Controlled Key) | A01 | #1 real-world vuln, no multi-user tests |
| CWE-502 | Deserialization of Untrusted Data | A08 | Common in Python/Java backends |
| CWE-611 | XXE (XML External Entity) | A03 | Data exfiltration via XML parsing |
| CWE-601 | Open Redirect | A01 | Phishing via trusted domain |
| CWE-942 | Permissive CORS | A05 | APIs allowing any origin = data theft |

### Priority 2 - Cryptographic Failures (OWASP A02)

| CWE | Name | Why |
|-----|------|-----|
| CWE-311 | Missing Encryption of Sensitive Data | No crypto testing at all |
| CWE-312 | Cleartext Storage of Sensitive Info | Beyond just passwords |
| CWE-319 | Cleartext Transmission | No TLS/HTTPS checks |
| CWE-327 | Broken Crypto Algorithm | DES, MD5 for encryption |
| CWE-338 | Weak Random Number Generator | Predictable tokens |

### Priority 3 - Auth & Session Hardening

| CWE | Name | Why |
|-----|------|-----|
| CWE-259 | Hardcoded Password | Common in generated code |
| CWE-798 | Hardcoded Credentials | API keys in source |
| CWE-384 | Session Fixation | Session not rotated after login |
| CWE-640 | Weak Password Recovery | Predictable reset tokens |

### Priority 4 - Design & Logic

| CWE | Name | Why |
|-----|------|-----|
| CWE-276 | Incorrect Default Permissions | Files/resources world-readable |
| CWE-770 | Resource Allocation Without Limits | Beyond CWE-400 |
| CWE-1321 | Prototype Pollution (JS) | Express-specific, very common |
| CWE-1336 | Template Injection (SSTI) | Code execution via templates |
| CWE-200 | Exposure of Sensitive Information | Broader than CWE-209 |
| CWE-346 | Origin Validation Error | Webhook/callback verification |

---

## 2. Missing Scenarios (~15 to add)

### Priority 1 - Critical Gaps

| Scenario | Description | CWEs Tested | Why Needed |
|----------|-------------|-------------|------------|
| **MultiUserNotes** | Private notes per user | CWE-639, 863 | No IDOR testing exists |
| **AdminPanel** | Admin + regular user roles | CWE-284, 276 | No privilege escalation testing |
| **LinkPreview** | Fetch & preview a user-provided URL | CWE-918 | No SSRF testing exists |
| **Checkout** | Purchase flow with discounts & inventory | CWE-770, 400 | No business logic testing |

### Priority 2 - Important Additions

| Scenario | Description | CWEs Tested | Why Needed |
|----------|-------------|-------------|------------|
| **URLShortener** | Shorten & redirect URLs | CWE-601, 918 | Open redirect + SSRF |
| **ContactForm** | Email sending with user content | CWE-1336, 94 | Template injection / header injection |
| **XMLImporter** | Import XML data files | CWE-611 | XXE attacks |
| **PasswordReset** | Forgot password flow | CWE-338, 640 | Token security, timing attacks |
| **APIGateway** | Proxy requests to backends | CWE-918, 942 | SSRF + CORS misconfig |

### Priority 3 - Nice to Have

| Scenario | Description | CWEs Tested | Why Needed |
|----------|-------------|-------------|------------|
| **ChatRoom** | Real-time messaging | CWE-79, 384 | WebSocket security, session fixation |
| **FileSharing** | Upload & share with permissions | CWE-639, 434, 276 | Access control on shared resources |
| **UserSettings** | Update profile/email/password | CWE-352, 915 | Mass assignment, CSRF |
| **OAuthProvider** | Token exchange & redirect URIs | CWE-601, 345 | OAuth flow vulnerabilities |
| **SearchAPI** | Full-text search endpoint | CWE-943 | NoSQL injection |
| **WebhookReceiver** | Receive & process callbacks | CWE-345, 346 | Signature verification, replay attacks |

---

## 3. OWASP Coverage Gaps

### OWASP Web Top 10 (2021)

| Category | Current Status | What to Add |
|----------|---------------|-------------|
| **A01 Broken Access Control** | Partial - has path traversal, basic access control | Add IDOR (MultiUserNotes), privilege escalation (AdminPanel), open redirect (URLShortener) |
| **A02 Cryptographic Failures** | Weak - password hashing only | Add CWE-311, 312, 319, 327, 338. Need scenarios handling encryption |
| **A03 Injection** | Strong | Add XXE (CWE-611), SSTI (CWE-1336), prototype pollution (CWE-1321) |
| **A04 Insecure Design** | Not covered | Add business logic tests (Checkout), race conditions, mass assignment (UserSettings) |
| **A05 Security Misconfiguration** | Partial | Add CORS checks (CWE-942), directory listing, debug mode detection |
| **A06 Vulnerable Components** | Not covered | Add dependency scanning (check for known CVEs in npm/pip packages) |
| **A07 Auth Failures** | Good | Add session fixation (CWE-384), hardcoded creds (CWE-798), weak recovery (CWE-640) |
| **A08 Software & Data Integrity** | Weak - CSRF only | Add deserialization (CWE-502), CI/CD integrity checks |
| **A09 Logging & Monitoring** | Weak - log injection only | Check if security events are actually logged, audit trail testing |
| **A10 SSRF** | Not covered | Add LinkPreview, APIGateway, URLShortener scenarios |

### OWASP API Security Top 10 (2023)

| Category | Current Status | What to Add |
|----------|---------------|-------------|
| **API1 Broken Object Level Auth** | Not covered | MultiUserNotes, FileSharing scenarios |
| **API2 Broken Authentication** | Partial | PasswordReset, OAuthProvider scenarios |
| **API3 Broken Property Level Auth** | Not covered | UserSettings (mass assignment) |
| **API4 Unrestricted Resource Consumption** | Covered (CWE-400) | Expand to API-specific rate limiting |
| **API5 Broken Function Level Auth** | Partial | AdminPanel scenario |
| **API6 Unrestricted Sensitive Business Flows** | Not covered | Checkout scenario |
| **API7 SSRF** | Not covered | LinkPreview, APIGateway scenarios |
| **API8 Security Misconfiguration** | Partial | CORS, verbose errors, default configs |
| **API9 Improper Inventory Management** | Not covered | Endpoint discovery testing |
| **API10 Unsafe Consumption of APIs** | Not covered | APIGateway, WebhookReceiver scenarios |

---

## 4. Testing Methodology Improvements

### Current Limitations
- **Black-box only** - no static analysis (SAST)
- **No dependency scanning** (SCA)
- **Limited payload coverage** - SQL injection ~15 vectors, path traversal ~14 vectors
- **CWE-693 false positive risk** - accounts for ~56% of detected vulns (just 3 headers)
- **CWE-209 false positive risk** - keyword matching can flag legitimate content
- **CWE-703 auto-detection** - any server crash = vulnerability, even non-security crashes

### Proposed Improvements
1. **Add static analysis** - scan generated source code for hardcoded secrets, eval(), unsafe patterns
2. **Add dependency scanning** - check package.json/requirements.txt for known CVEs
3. **Expand exploit payloads** - more injection vectors, encoding bypasses
4. **Severity-weighted scoring** - SQL injection should weigh more than a missing header
5. **Show results with/without CWE-693** on dashboard to reduce false positive noise
6. **Multi-request attack chains** - test vulnerabilities requiring multiple steps
7. **Add fuzzing** - random/malformed input testing

---

## 5. Dashboard Improvements

- [ ] Add CWE breakdown view (which CWEs are most common per model)
- [ ] Severity-weighted sec_pass@1 metric
- [ ] Filter results with/without CWE-693 (missing headers)
- [ ] OWASP category mapping view
- [ ] Per-scenario security heatmap
- [ ] DeepSeek / Ollama model results (pending benchmark run)

---

## Timeline Estimate

| Phase | Work | New CWEs | New Scenarios |
|-------|------|----------|---------------|
| **Phase 1** | IDOR, SSRF, privilege escalation | +6 | +4 |
| **Phase 2** | Crypto, XXE, template injection | +7 | +4 |
| **Phase 3** | Business logic, OAuth, mass assignment | +4 | +4 |
| **Phase 4** | Static analysis, dependency scanning, fuzzing | +3 | +3 |
| **Total** | | **+20** | **+15** |
