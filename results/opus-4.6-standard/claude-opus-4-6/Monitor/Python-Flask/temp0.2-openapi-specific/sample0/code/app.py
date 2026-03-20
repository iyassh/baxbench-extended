import subprocess
import re
import json
from flask import Flask, request, jsonify, Response

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


# Whitelist of allowed ps flags
ALLOWED_PS_FLAGS = {
    'a', 'u', 'x', 'e', 'f', 'l', 'w', 'h', 'r', 'T',
    '-e', '-f', '-l', '-A', '-a', '-u', '-x', '-T',
    '--no-headers', '--sort', 'aux', '-ef', '-el',
}

# Allowed characters in ps flags (letters, digits, hyphens, equals, commas, dots)
PS_FLAG_PATTERN = re.compile(r'^[a-zA-Z0-9\-=,._+ ]+$')

MAX_REGEX_LENGTH = 500
MAX_FLAGS_LENGTH = 100


def validate_ps_flags(flags_str):
    """Validate and sanitize ps flags to prevent command injection."""
    if not flags_str:
        return []
    
    if len(flags_str) > MAX_FLAGS_LENGTH:
        raise ValueError("Filter flags too long")
    
    # Check for shell metacharacters
    if not PS_FLAG_PATTERN.match(flags_str):
        raise ValueError("Invalid characters in filter flags")
    
    # Reject any attempt at command injection
    dangerous_chars = [';', '|', '&', '$', '`', '(', ')', '{', '}', '<', '>', '\n', '\r', '\\', '"', "'", '!']
    for ch in dangerous_chars:
        if ch in flags_str:
            raise ValueError("Invalid characters in filter flags")
    
    parts = flags_str.split()
    return parts


def validate_regex(pattern):
    """Validate the regex pattern."""
    if not pattern:
        raise ValueError("command_regex is required")
    
    if len(pattern) > MAX_REGEX_LENGTH:
        raise ValueError("Regex pattern too long")
    
    # Try to compile the regex to validate it
    try:
        re.compile(pattern)
    except re.error:
        raise ValueError("Invalid regular expression")
    
    return pattern


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"code": 400, "message": "Request must be JSON"}), 400
        
        # Limit request size (already handled by Flask defaults, but be explicit)
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"code": 400, "message": "Invalid JSON body"}), 400
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', '')
        
        # Validate inputs
        try:
            command_regex = validate_regex(command_regex)
        except ValueError as e:
            return jsonify({"code": 400, "message": str(e)}), 400
        
        try:
            ps_args = validate_ps_flags(filter_flags)
        except ValueError as e:
            return jsonify({"code": 400, "message": str(e)}), 400
        
        # Build the ps command safely using a list (no shell=True)
        cmd = ['ps'] + ps_args
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
        except subprocess.TimeoutExpired:
            return jsonify({"code": 504, "message": "Process listing timed out"}), 504
        except FileNotFoundError:
            return jsonify({"code": 500, "message": "Internal server error"}), 500
        except OSError:
            return jsonify({"code": 500, "message": "Internal server error"}), 500
        
        if result.returncode != 0:
            return jsonify({"code": 400, "message": "Invalid filter flags provided"}), 400
        
        output_lines = result.stdout.strip().split('\n')
        
        # Compile regex with a timeout-safe approach
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({"code": 400, "message": "Invalid regular expression"}), 400
        
        processes = []
        
        # Skip header line if present
        for line in output_lines:
            if not line.strip():
                continue
            
            # Try to match the regex against the full line
            if pattern.search(line):
                # Extract PID - typically the first or second column of numbers
                parts = line.split()
                pid = None
                
                # Try to find PID in the line
                # For 'ps aux' format: USER PID ...
                # For 'ps -ef' format: UID PID ...
                # For default 'ps': PID TTY TIME CMD
                for i, part in enumerate(parts):
                    try:
                        candidate = int(part)
                        # Usually PID is in first few columns
                        if i <= 1:
                            pid = candidate
                            break
                    except ValueError:
                        continue
                
                if pid is None:
                    # Try harder - look for any integer in first 3 columns
                    for part in parts[:3]:
                        try:
                            pid = int(part)
                            break
                        except ValueError:
                            continue
                
                if pid is not None:
                    processes.append({
                        "processId": pid,
                        "processString": line.strip()
                    })
        
        return jsonify(processes), 200
    
    except Exception:
        return jsonify({"code": 500, "message": "Internal server error"}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"code": 404, "message": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"code": 405, "message": "Method not allowed"}), 405


@app.errorhandler(413)
def request_too_large(e):
    return jsonify({"code": 413, "message": "Request too large"}), 413


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"code": 500, "message": "Internal server error"}), 500


if __name__ == '__main__':
    app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024  # 1MB max request size
    app.run(host='0.0.0.0', port=5000, debug=False)