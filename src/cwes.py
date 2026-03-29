from enum import Enum


class CWE(Enum):
    """
    CWE nums and official MITRE descriptions.
    """

    XSS = {
        "num": 79,
        "desc": "The product does not neutralize or incorrectly neutralizes user-controllable input before it is placed in output that is used as a web page that is served to other users.",
    }
    PATH_TRAVERSAL = {
        "num": 22,
        "desc": "The product uses external input to construct a pathname that is intended to identify a file or directory that is located underneath a restricted parent directory, but the product does not properly neutralize special elements within the pathname that can cause the pathname to resolve to a location that is outside of the restricted directory.",
    }
    CODE_INJECTION = {
        "num": 94,
        "desc": "The product constructs all or part of a code segment using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the syntax or behavior of the intended code segment.",
    }
    SQL_INJECTION = {
        "num": 89,
        "desc": "The product constructs all or part of an SQL command using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the intended SQL command when it is sent to a downstream component. Without sufficient removal or quoting of SQL syntax in user-controllable inputs, the generated SQL query can cause those inputs to be interpreted as SQL instead of ordinary user data.",
    }
    IMPROPER_ACCESS_CONTROL = {
        "num": 284,
        "desc": "The product does not restrict or incorrectly restricts access to a resource from an unauthorized actor.",
    }
    IMPROPER_AUTHENTICATION = {
        "num": 287,
        "desc": "When an actor claims to have a given identity, the product does not prove or insufficiently proves that the claim is correct.",
    }
    IMPROPER_OUTPUT_NEUTRALIZATION_FOR_LOGS = {
        "num": 117,
        "desc": "The product does not neutralize or incorrectly neutralizes output that is written to logs.",
    }
    OS_INJECTION = {
        "num": 78,
        "desc": "The product constructs all or part of an OS command using externally-influenced input from an upstream component, but it does not neutralize or incorrectly neutralizes special elements that could modify the intended OS command when it is sent to a downstream component.",
    }
    UNCONTROLLED_RESOURCE_CONSUMPTION = {
        "num": 400,
        "desc": "The product does not properly control the allocation and maintenance of a limited resource, thereby enabling an actor to influence the amount of resources consumed, eventually leading to the exhaustion of available resources.",
    }
    UNRESTRICTED_UPLOAD_WITH_DANGEROUS_FILE = {
        "num": 434,
        "desc": "The product allows the upload or transfer of dangerous file types that are automatically processed within its environment.",
    }
    INSUFFICIENTLY_PROTECTED_CREDENTIALS = {
        "num": 522,
        "desc": "The product transmits or stores authentication credentials, but it uses an insecure method that is susceptible to unauthorized interception and/or retrieval.",
    }
    INCORRECT_AUTHORIZATION = {
        "num": 863,
        "desc": "The product performs an authorization check when an actor attempts to access a resource or perform an action, but it does not correctly perform the check.",
    }
    IMPROPER_CHECK_OR_HANDLING_OF_EXCEPTIONAL_CONDITIONS = {
        "num": 703,
        "desc": "The product does not properly anticipate or handle exceptional conditions that rarely occur during normal operation of the product.",
    }
    IMPROPER_INPUT_VALIDATION = {
        "num": 20,
        "desc": "The product receives input or data, but it does not validate or incorrectly validates that the input has the properties that are required to process the data safely and correctly.",
    }

    # --- Extended BaxBench CWEs ---
    MISSING_SECURITY_HEADERS = {
        "num": 693,
        "desc": "The product does not use or incorrectly uses a protection mechanism that provides sufficient defense against directed attacks against the product (missing security headers such as X-Content-Type-Options, X-Frame-Options, Content-Security-Policy).",
    }
    ERROR_INFO_LEAKAGE = {
        "num": 209,
        "desc": "The product generates an error message that includes sensitive information about its environment, users, or associated data.",
    }
    BRUTE_FORCE_NO_RATE_LIMIT = {
        "num": 307,
        "desc": "The product does not implement sufficient measures to prevent multiple failed authentication attempts within a short time frame, making it easier for attackers to perform brute force attacks.",
    }
    SESSION_NO_HTTPONLY = {
        "num": 614,
        "desc": "The product uses a cookie to store sensitive information, but the cookie is not marked with the HttpOnly flag.",
    }
    SESSION_NO_SAMESITE = {
        "num": 1275,
        "desc": "The product uses a cookie to store sensitive information, but the cookie is not marked with the SameSite attribute.",
    }
    SESSION_NOT_INVALIDATED = {
        "num": 613,
        "desc": "The product does not sufficiently expire or invalidate a session after logout, allowing the session to be reused.",
    }
    CSRF_MISSING = {
        "num": 352,
        "desc": "The web application does not, or can not, sufficiently verify whether a well-formed, valid, consistent request was intentionally provided by the user who submitted the request (Cross-Site Request Forgery).",
    }
    JWT_ALG_NONE = {
        "num": 345,
        "desc": "The product does not sufficiently verify the origin or authenticity of data, allowing JWT tokens with algorithm set to 'none' to bypass signature verification.",
    }
    JWT_WEAK_SECRET = {
        "num": 347,
        "desc": "The product does not verify, or incorrectly verifies, the cryptographic signature for data, using a weak or guessable HMAC secret for JWT signing.",
    }
    JWT_NO_EXPIRY = {
        "num": 345,
        "desc": "The product does not sufficiently verify the origin or authenticity of data, issuing JWT tokens without an expiration claim.",
    }
    IDOR = {
        "num": 639,
        "desc": "The system's authorization functionality does not prevent one user from gaining access to another user's data or record by modifying the key value identifying the data.",
    }
    SSRF = {
        "num": 918,
        "desc": "The web server receives a URL or similar request from an upstream component and retrieves the contents of this URL, but it does not sufficiently ensure that the request is being sent to the expected destination.",
    }
    MISSING_AUTHORIZATION = {
        "num": 862,
        "desc": "The product does not perform an authorization check when an actor attempts to access a resource or perform an action.",
    }
    XXE = {
        "num": 611,
        "desc": "The product processes an XML document that can contain XML entities with URIs that resolve to documents outside of the intended sphere of control, causing the product to embed incorrect documents into its output.",
    }

    # --- OWASP 2025 New CWEs ---
    PERMISSIVE_CORS = {
        "num": 942,
        "desc": "The product uses a cross-domain policy file that includes domains that should not be trusted.",
    }
    VULNERABLE_COMPONENT = {
        "num": 1104,
        "desc": "The product relies on third-party components that are not actively maintained or have known security vulnerabilities.",
    }
    WEAK_CRYPTO = {
        "num": 327,
        "desc": "The use of a broken or risky cryptographic algorithm is an unnecessary risk that may result in the exposure of sensitive information.",
    }
    WEAK_PRNG = {
        "num": 338,
        "desc": "The product uses a Pseudo-Random Number Generator (PRNG) in a security context, but the PRNG's algorithm is not cryptographically strong.",
    }
    HARDCODED_CREDENTIALS = {
        "num": 798,
        "desc": "The product contains hard-coded credentials, such as a password or cryptographic key, which it uses for its own inbound authentication, outbound communication, or encryption.",
    }
    BUSINESS_LOGIC_ERROR = {
        "num": 840,
        "desc": "The product does not properly enforce business rules, allowing users to manipulate the system in unintended ways.",
    }
    SESSION_FIXATION = {
        "num": 384,
        "desc": "Authenticating a user, or otherwise establishing a new user session, without invalidating any existing session identifier gives an attacker the opportunity to steal authenticated sessions.",
    }
    WEAK_PASSWORD_RECOVERY = {
        "num": 640,
        "desc": "The product contains a mechanism for users to recover or change their passwords without knowing the original password, but the mechanism is weak.",
    }
    DESERIALIZATION = {
        "num": 502,
        "desc": "The product deserializes untrusted data without sufficiently verifying that the resulting data will be valid.",
    }
    MASS_ASSIGNMENT = {
        "num": 915,
        "desc": "The product receives input that specifies a set of properties to initialize in an object, but it does not properly restrict which properties can be modified.",
    }
    FAILING_OPEN = {
        "num": 636,
        "desc": "When the product encounters an error condition or failure, its design requires it to fall back to a state that is less secure than other options that are available.",
    }
