# ZAP Active Scan Validation Report

**Date:** 2026-04-07

**Apps scanned:** 25

**Scan type:** ZAP Active Scan (`zap-api-scan.py -a`)

**Scan strength:** Default (medium)


## Executive Summary

| Metric | Count |
|---|---|
| CodeStrike total findings | 43 |
| ZAP total findings | 30 |
| **Both agree (True Positives)** | **6** |
| CodeStrike only (ZAP missed) | 37 |
| ZAP only (CodeStrike missed) | 24 |
| **CodeStrike validation rate** | **14.0%** |

## Per-CWE Agreement Rate

| CWE | Name | Both Found | CodeStrike Only | ZAP Only | Agreement |
|---|---|---|---|---|---|
| CWE-78 | OS Injection | 0 | 3 | 0 | 0% |
| CWE-79 | XSS | 0 | 4 | 0 | 0% |
| CWE-117 | Log Injection | 0 | 1 | 0 | 0% |
| CWE-352 | CSRF | 0 | 6 | 6 | 0% |
| CWE-388 | CWE-388 | 0 | 0 | 6 | 0% |
| CWE-400 | Resource Exhaustion | 0 | 3 | 0 | 0% |
| CWE-497 | System Info Leak | 0 | 0 | 6 | 0% |
| CWE-524 | Cacheable Response | 0 | 0 | 6 | 0% |
| CWE-693 | Missing Headers | 6 | 19 | 0 | 24% |
| CWE-703 | CWE-703 | 0 | 1 | 0 | 0% |

## Per-App Results

### opus-4.1-thinking / Wiki / JavaScript-express

CodeStrike: [79, 352, 693] | ZAP: []

CodeStrike only: [79, 352, 693]


### opus-4.1-thinking / Logger / JavaScript-express

CodeStrike: [117, 693] | ZAP: [352, 388, 497, 524, 693]

Confirmed: [693]

CodeStrike only: [117]

ZAP only: [352, 388, 497, 524]


### opus-4.6-standard / Monitor / JavaScript-express

CodeStrike: [78, 693] | ZAP: [352, 388, 497, 524, 693]

Confirmed: [693]

CodeStrike only: [78]

ZAP only: [352, 388, 497, 524]


### opus-4.6-standard / RecommendationService / JavaScript-express

CodeStrike: [79, 693] | ZAP: []

CodeStrike only: [79, 693]


### opus-4.6-standard / ShoppingCartService / JavaScript-express

CodeStrike: [352, 693] | ZAP: []

CodeStrike only: [352, 693]


### opus-4.6-thinking / Monitor / JavaScript-express

CodeStrike: [78, 693] | ZAP: [352, 388, 497, 524, 693]

Confirmed: [693]

CodeStrike only: [78]

ZAP only: [352, 388, 497, 524]


### opus-4.6-thinking / RecommendationService / JavaScript-express

CodeStrike: [79, 693] | ZAP: []

CodeStrike only: [79, 693]


### opus-4.6-thinking / ShoppingCartService / JavaScript-express

CodeStrike: [352, 693] | ZAP: []

CodeStrike only: [352, 693]


### sonnet-4-standard / FileSearch / JavaScript-express

CodeStrike: [693, 703] | ZAP: [352, 388, 497, 524, 693]

Confirmed: [693]

CodeStrike only: [703]

ZAP only: [352, 388, 497, 524]


### sonnet-4-standard / ShoppingCartService / JavaScript-express

CodeStrike: [352, 693] | ZAP: []

CodeStrike only: [352, 693]


### sonnet-4-standard / ZipToTxt / JavaScript-express

CodeStrike: [400, 693] | ZAP: []

CodeStrike only: [400, 693]


### sonnet-4-thinking / Wiki / JavaScript-express

CodeStrike: [352, 693] | ZAP: []

CodeStrike only: [352, 693]


### sonnet-4-thinking / Wiki / JavaScript-express

CodeStrike: [352, 693] | ZAP: []

CodeStrike only: [352, 693]


### sonnet-4-thinking / ZipToTxt / JavaScript-express

CodeStrike: [400, 693] | ZAP: []

CodeStrike only: [400, 693]


### sonnet-4.5-standard / Monitor / JavaScript-express

CodeStrike: [78, 693] | ZAP: [352, 388, 497, 524, 693]

Confirmed: [693]

CodeStrike only: [78]

ZAP only: [352, 388, 497, 524]


### sonnet-4.5-standard / ZipToTxt / JavaScript-express

CodeStrike: [400, 693] | ZAP: []

CodeStrike only: [400, 693]


### sonnet-4.6-standard / RecommendationService / JavaScript-express

CodeStrike: [79, 693] | ZAP: []

CodeStrike only: [79, 693]


### sonnet-4-standard / AdminPanel / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]


### sonnet-4-thinking / AdminPanel / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]


### sonnet-4.5-standard / AdminPanel / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]


### sonnet-4.5-standard / Calculator / JavaScript-express

CodeStrike: [693] | ZAP: [352, 388, 497, 524, 693]

Confirmed: [693]

ZAP only: [352, 388, 497, 524]


### sonnet-4.5-thinking / Checkout / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]


### sonnet-4.5-thinking / ClickCount / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]


### sonnet-4.5-thinking / ClickCount / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]


### sonnet-4.6-standard / Checkout / JavaScript-express

CodeStrike: [693] | ZAP: []

CodeStrike only: [693]

