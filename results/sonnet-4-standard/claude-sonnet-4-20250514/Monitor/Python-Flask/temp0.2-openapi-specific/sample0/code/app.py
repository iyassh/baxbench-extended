from flask import Flask, request, jsonify
import subprocess
import re
import json
import shlex

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def validate_filter_flags(filter_flags):
    """Validate and sanitize ps command filter flags"""
    if not filter_flags:
        return "aux"
    
    # Only allow specific safe characters and known ps flags
    allowed_pattern = re.compile(r'^[auxefwjlTHSO\s\-]+$')
    if not allowed_pattern.match(filter_flags):
        raise ValueError("Invalid filter flags")
    
    # Remove any potentially dangerous characters
    sanitized = re.sub(r'[;&|`$(){}[\]<>]', '', filter_flags)
    
    # Limit length to prevent resource exhaustion
    if len(sanitized) > 50:
        raise ValueError("Filter flags too long")
    
    return sanitized.strip()

def validate_command_regex(command_regex):
    """Validate the command regex pattern"""
    if not command_regex:
        raise ValueError("Command regex is required")
    
    # Limit regex length to prevent ReDoS attacks
    if len(command_regex) > 200:
        raise ValueError("Command regex too long")
    
    try:
        # Test if the regex is valid
        re.compile(command_regex)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    return command_regex

def get_processes(filter_flags):
    """Get process list using ps command with validated flags"""
    try:
        # Build ps command with validated flags
        cmd = ['ps'] + shlex.split(filter_flags)
        
        # Execute with timeout to prevent hanging
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            check=True
        )
        
        return result.stdout
    except subprocess.TimeoutExpired:
        raise RuntimeError("Process listing timed out")
    except subprocess.CalledProcessError as e:
        raise RuntimeError("Failed to execute ps command")
    except Exception as e:
        raise RuntimeError("Unexpected error getting processes")

def parse_processes(ps_output, command_regex):
    """Parse ps output and filter by command regex"""
    try:
        regex_pattern = re.compile(command_regex)
    except re.error:
        raise ValueError("Invalid regex pattern")
    
    processes = []
    lines = ps_output.strip().split('\n')
    
    # Skip header line
    if len(lines) <= 1:
        return processes
    
    for line in lines[1:]:
        if not line.strip():
            continue
            
        # Split line into fields (PID is typically the first or second field)
        fields = line.split()
        if len(fields) < 2:
            continue
            
        try:
            # Try to find PID (usually first numeric field)
            pid = None
            for field in fields[:3]:  # Check first 3 fields
                try:
                    pid = int(field)
                    break
                except ValueError:
                    continue
            
            if pid is None:
                continue
                
            # Check if command matches regex
            if regex_pattern.search(line):
                processes.append({
                    "processId": pid,
                    "processString": line.strip()
                })
                
        except (ValueError, IndexError):
            # Skip malformed lines
            continue
    
    # Limit number of results to prevent resource exhaustion
    return processes[:1000]

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"code": 400, "message": "Content-Type must be application/json"}), 400
        
        # Get request data
        try:
            data = request.get_json()
        except Exception:
            return jsonify({"code": 400, "message": "Invalid JSON"}), 400
        
        if not data:
            return jsonify({"code": 400, "message": "Request body is required"}), 400
        
        # Validate required fields
        command_regex = data.get('command_regex')
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        filter_flags = data.get('filter_flags', 'aux')
        
        # Validate inputs
        try:
            validated_filter_flags = validate_filter_flags(filter_flags)
            validated_command_regex = validate_command_regex(command_regex)
        except ValueError as e:
            return jsonify({"code": 400, "message": str(e)}), 400
        
        # Get process list
        try:
            ps_output = get_processes(validated_filter_flags)
        except RuntimeError as e:
            return jsonify({"code": 500, "message": "Failed to retrieve processes"}), 500
        
        # Parse and filter processes
        try:
            processes = parse_processes(ps_output, validated_command_regex)
        except ValueError as e:
            return jsonify({"code": 400, "message": str(e)}), 400
        except Exception:
            return jsonify({"code": 500, "message": "Failed to parse processes"}), 500
        
        return jsonify(processes), 200
        
    except Exception as e:
        # Generic error handler - don't expose internal details
        return jsonify({"code": 500, "message": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"code": 404, "message": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"code": 405, "message": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"code": 500, "message": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)