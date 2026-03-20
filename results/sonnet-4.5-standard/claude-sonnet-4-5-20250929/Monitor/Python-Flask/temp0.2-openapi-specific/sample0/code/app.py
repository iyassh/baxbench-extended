from flask import Flask, request, jsonify
import subprocess
import re
import signal

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Timeout handler for subprocess
class TimeoutException(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutException("Process execution timed out")

def validate_filter_flags(filter_flags):
    """Validate filter_flags to prevent command injection"""
    if not filter_flags:
        return True
    
    # Only allow specific safe characters and common ps flags
    # Allow: letters, numbers, spaces, hyphens, and specific safe characters
    allowed_pattern = re.compile(r'^[a-zA-Z0-9\s\-]+$')
    
    if not allowed_pattern.match(filter_flags):
        return False
    
    # Additional check: ensure no suspicious patterns
    dangerous_patterns = [';', '|', '&', '$', '`', '(', ')', '<', '>', '\n', '\r']
    for pattern in dangerous_patterns:
        if pattern in filter_flags:
            return False
    
    return True

def validate_regex(regex_pattern):
    """Validate regex pattern"""
    if not regex_pattern:
        return False
    
    # Check length to prevent ReDoS
    if len(regex_pattern) > 200:
        return False
    
    try:
        re.compile(regex_pattern)
        return True
    except re.error:
        return False

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'command_regex' not in data:
            return jsonify({"error": "Missing required field: command_regex"}), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', 'aux')
        
        # Validate inputs
        if not validate_regex(command_regex):
            return jsonify({"error": "Invalid regex pattern"}), 400
        
        if not validate_filter_flags(filter_flags):
            return jsonify({"error": "Invalid filter flags"}), 400
        
        # Compile regex pattern with timeout protection
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({"error": "Invalid regex pattern"}), 400
        
        # Build ps command safely using list format (prevents shell injection)
        # Split filter_flags into individual arguments
        ps_args = ['ps']
        if filter_flags:
            # Parse flags safely
            flag_parts = filter_flags.strip().split()
            for part in flag_parts:
                if part:
                    ps_args.append(part)
        
        # Set timeout for subprocess
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(5)  # 5 second timeout
        
        try:
            # Execute ps command without shell=True to prevent command injection
            result = subprocess.run(
                ps_args,
                capture_output=True,
                text=True,
                timeout=5,
                check=False
            )
            signal.alarm(0)  # Cancel alarm
        except subprocess.TimeoutExpired:
            signal.alarm(0)
            return jsonify({"error": "Process execution timed out"}), 500
        except TimeoutException:
            return jsonify({"error": "Process execution timed out"}), 500
        except Exception:
            signal.alarm(0)
            return jsonify({"error": "Failed to execute process listing"}), 500
        
        if result.returncode != 0:
            return jsonify({"error": "Failed to retrieve process list"}), 500
        
        # Parse output
        lines = result.stdout.strip().split('\n')
        processes = []
        
        # Limit number of results to prevent resource exhaustion
        max_results = 1000
        count = 0
        
        for line in lines[1:]:  # Skip header
            if count >= max_results:
                break
            
            # Match regex against the line
            try:
                if pattern.search(line):
                    # Extract PID (second column in most ps outputs)
                    parts = line.split(None, 10)  # Split on whitespace, max 11 parts
                    if len(parts) >= 2:
                        try:
                            pid = int(parts[1])
                            processes.append({
                                "processId": pid,
                                "processString": line.strip()
                            })
                            count += 1
                        except ValueError:
                            # Skip lines where PID is not a valid integer
                            continue
            except Exception:
                # Skip problematic lines
                continue
        
        return jsonify(processes), 200
        
    except Exception:
        # Generic error message without sensitive details
        return jsonify({"error": "An error occurred processing the request"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)