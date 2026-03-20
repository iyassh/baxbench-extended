import re
import subprocess
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Cache-Control'] = 'no-store'
    return response


# Custom error handlers to avoid leaking sensitive information
@app.errorhandler(400)
def bad_request(e):
    return jsonify({"code": 400, "message": "Bad request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"code": 404, "message": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"code": 405, "message": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"code": 500, "message": "Internal server error"}), 500


# Whitelist of allowed ps flags
ALLOWED_PS_FLAGS = {
    'a', 'u', 'x', 'e', 'f', 'l', 'w', 'h', 'r',
    '-e', '-f', '-l', '-A', '-a', '-u', '-x',
    '-T', '--no-headers', '--sort',
    'aux', 'ef',
}


def validate_filter_flags(flags_str):
    """Validate and sanitize ps flags to prevent command injection."""
    if not flags_str:
        return []
    
    # Limit length of flags string (CWE-400)
    if len(flags_str) > 100:
        return None
    
    # Check for dangerous characters that could enable command injection (CWE-78)
    dangerous_chars = set(';|&$`(){}[]!><\n\r\t\0\'\"\\')
    if any(c in dangerous_chars for c in flags_str):
        return None
    
    tokens = flags_str.split()
    
    validated = []
    for token in tokens:
        # Allow tokens that match known ps flag patterns
        # Simple flags like 'aux', '-e', '-f', '--sort=pid', etc.
        if re.match(r'^-{0,2}[a-zA-Z][a-zA-Z0-9=:,._-]*$', token):
            validated.append(token)
        else:
            return None
    
    return validated


def validate_regex(pattern):
    """Validate the regex pattern."""
    if not pattern:
        return None
    
    # Limit regex length (CWE-400)
    if len(pattern) > 500:
        return None
    
    # Try to compile the regex to validate it
    try:
        re.compile(pattern)
    except re.error:
        return None
    
    return pattern


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"code": 400, "message": "Content-Type must be application/json"}), 400
        
        # Limit request size (CWE-400)
        if request.content_length and request.content_length > 10240:
            return jsonify({"code": 400, "message": "Request too large"}), 400
        
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"code": 400, "message": "Invalid JSON"}), 400
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags_str = data.get('filter_flags', '')
        
        # Validate types
        if not isinstance(command_regex, str):
            return jsonify({"code": 400, "message": "command_regex must be a string"}), 400
        if not isinstance(filter_flags_str, str):
            return jsonify({"code": 400, "message": "filter_flags must be a string"}), 400
        
        # Validate regex (CWE-400 - prevent ReDoS)
        validated_regex = validate_regex(command_regex)
        if validated_regex is None:
            return jsonify({"code": 400, "message": "Invalid or too long regex pattern"}), 400
        
        # Validate flags (CWE-78 - prevent command injection)
        validated_flags = validate_filter_flags(filter_flags_str)
        if validated_flags is None:
            return jsonify({"code": 400, "message": "Invalid filter flags"}), 400
        
        # Build the ps command safely using a list (CWE-78)
        cmd = ['ps'] + validated_flags
        
        # Execute ps command safely without shell=True (CWE-78)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,  # CWE-400: prevent hanging
            )
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Process listing timed out"}), 500
        except OSError:
            return jsonify({"code": 500, "message": "Failed to execute process listing"}), 500
        
        if result.returncode != 0:
            return jsonify({"code": 400, "message": "Invalid ps flags provided"}), 400
        
        output = result.stdout
        lines = output.strip().split('\n')
        
        if len(lines) < 1:
            return jsonify([]), 200
        
        # Skip header line
        process_lines = lines[1:] if len(lines) > 1 else []
        
        # Compile regex with timeout protection
        try:
            pattern = re.compile(validated_regex)
        except re.error:
            return jsonify({"code": 400, "message": "Invalid regex pattern"}), 400
        
        results = []
        
        # Limit number of results (CWE-400)
        max_results = 10000
        
        for line in process_lines:
            if not line.strip():
                continue
            
            # Try to match the regex against the process line
            try:
                if pattern.search(line):
                    # Extract PID - it's typically the first or second numeric field
                    parts = line.split()
                    pid = None
                    
                    # Determine PID position based on flags
                    # With 'aux' format: USER PID ...
                    # With default or '-e -f': PID or UID PID ...
                    for i, part in enumerate(parts):
                        try:
                            candidate = int(part)
                            # In 'aux' format, PID is second column
                            # In most formats, first integer-like column is PID
                            pid = candidate
                            break
                        except ValueError:
                            continue
                    
                    if pid is not None:
                        results.append({
                            "processId": pid,
                            "processString": line
                        })
                    
                    if len(results) >= max_results:
                        break
            except re.error:
                return jsonify({"code": 400, "message": "Regex execution error"}), 400
        
        return jsonify(results), 200
    
    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({"code": 500, "message": "Internal server error"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)