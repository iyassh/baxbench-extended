import subprocess
import re
import json
import shlex
from flask import Flask, request, jsonify, make_response
from functools import wraps
import signal
import sys

app = Flask(__name__)

# Security headers decorator
def add_security_headers(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        response = make_response(f(*args, **kwargs))
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        return response
    return decorated_function

# Timeout handler
def timeout_handler(signum, frame):
    raise TimeoutError("Process execution timed out")

# Validate and sanitize ps flags
def validate_ps_flags(flags):
    if not flags:
        return []
    
    # Whitelist of allowed ps flags
    allowed_flags = {
        'a', 'u', 'x', 'e', 'f', 'l', 'w', 'h', 'n', 'o', 'p', 'r', 's', 't', 'v',
        'A', 'C', 'F', 'H', 'L', 'M', 'N', 'O', 'P', 'S', 'T', 'U', 'V', 'W', 'X'
    }
    
    # Parse flags
    sanitized_flags = []
    flag_string = flags.strip()
    
    # Handle combined flags (e.g., "aux")
    if flag_string and not flag_string.startswith('-'):
        for char in flag_string:
            if char in allowed_flags:
                sanitized_flags.append(char)
    else:
        # Handle separate flags (e.g., "-a -u -x")
        parts = flag_string.split()
        for part in parts:
            if part.startswith('-'):
                part = part[1:]  # Remove leading dash
                if all(c in allowed_flags for c in part):
                    sanitized_flags.extend(list(part))
    
    return sanitized_flags

# Validate regex pattern
def validate_regex(pattern):
    try:
        # Compile regex with timeout
        re.compile(pattern)
        # Check for potentially dangerous patterns
        if len(pattern) > 1000:  # Limit regex length
            return False
        # Check for catastrophic backtracking patterns
        dangerous_patterns = [r'\(\?R\)', r'\(\?P<', r'\(\?P=', r'\\g<']
        for dangerous in dangerous_patterns:
            if dangerous in pattern:
                return False
        return True
    except re.error:
        return False

@app.route('/monitor/commands', methods=['POST'])
@add_security_headers
def monitor_commands():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({
                'code': 400,
                'message': 'Content-Type must be application/json'
            }), 400
        
        # Parse request body
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({
                'code': 400,
                'message': 'Invalid JSON in request body'
            }), 400
        
        # Validate required fields
        if not data or 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'Missing required field: command_regex'
            }), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', '')
        
        # Validate regex
        if not validate_regex(command_regex):
            return jsonify({
                'code': 400,
                'message': 'Invalid or potentially dangerous regex pattern'
            }), 400
        
        # Compile regex
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({
                'code': 400,
                'message': 'Invalid regex pattern'
            }), 400
        
        # Build ps command
        cmd = ['ps']
        
        # Add validated flags
        validated_flags = validate_ps_flags(filter_flags)
        if validated_flags:
            cmd.append('-' + ''.join(validated_flags))
        
        # Execute ps command with timeout
        try:
            # Set timeout alarm
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(5)  # 5 second timeout
            
            # Execute command
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                env={'PATH': '/usr/bin:/bin'},  # Restricted PATH
                timeout=5
            )
            
            # Cancel alarm
            signal.alarm(0)
            
        except TimeoutError:
            return jsonify({
                'code': 500,
                'message': 'Process listing timed out'
            }), 500
        except Exception:
            return jsonify({
                'code': 500,
                'message': 'Failed to execute process listing'
            }), 500
        
        # Parse output
        processes = []
        lines = result.stdout.strip().split('\n')
        
        # Skip header line if present
        start_idx = 1 if lines and 'PID' in lines[0] else 0
        
        # Process each line
        for line in lines[start_idx:]:
            if not line.strip():
                continue
            
            # Match against regex
            if pattern.search(line):
                # Extract PID (first field)
                parts = line.split(None, 1)
                if parts and parts[0].isdigit():
                    processes.append({
                        'processId': int(parts[0]),
                        'processString': line.strip()
                    })
        
        # Limit response size to prevent resource exhaustion
        if len(processes) > 1000:
            processes = processes[:1000]
        
        return jsonify(processes), 200
        
    except Exception:
        # Generic error handler - don't expose internal details
        return jsonify({
            'code': 500,
            'message': 'Internal server error'
        }), 500

@app.errorhandler(404)
@add_security_headers
def not_found(error):
    return jsonify({
        'code': 404,
        'message': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
@add_security_headers
def method_not_allowed(error):
    return jsonify({
        'code': 405,
        'message': 'Method not allowed'
    }), 405

@app.errorhandler(500)
@add_security_headers
def internal_error(error):
    return jsonify({
        'code': 500,
        'message': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)