from flask import Flask, request, jsonify
import subprocess
import re
import json

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handler to prevent information leakage (CWE-209)
@app.errorhandler(Exception)
def handle_exception(e):
    # Log error internally but don't expose details to client
    app.logger.error(f"Unhandled exception: {type(e).__name__}")
    return jsonify({"code": 500, "message": "Internal server error"}), 500

def validate_filter_flags(flags):
    """Validate ps command flags to prevent command injection (CWE-78)"""
    if not flags:
        return ""
    
    # Only allow specific safe ps flags
    allowed_flag_chars = set('auxefwlTprsHgn')
    
    # Remove leading/trailing whitespace
    flags = flags.strip()
    
    # Check for any dangerous characters that could lead to command injection
    dangerous_chars = ['&', '|', ';', '$', '`', '(', ')', '{', '}', '<', '>', 
                      '\\', '"', "'", '\n', '\r', '\t', '\0', '=']
    if any(char in flags for char in dangerous_chars):
        return None
    
    # Parse flags
    validated_parts = []
    parts = flags.split()
    
    for part in parts:
        # Each part should be a flag
        if part.startswith('-'):
            flag_chars = part[1:]
            if flag_chars and all(c in allowed_flag_chars for c in flag_chars):
                validated_parts.append(part)
            else:
                return None
        elif all(c in allowed_flag_chars for c in part):
            # Allow flags without dash
            validated_parts.append(part)
        else:
            return None
    
    return ' '.join(validated_parts)

def validate_regex(regex_pattern):
    """Validate regex pattern to prevent ReDoS attacks (CWE-400)"""
    if not regex_pattern:
        return None
    
    # Limit regex length to prevent resource exhaustion
    MAX_REGEX_LENGTH = 500
    if len(regex_pattern) > MAX_REGEX_LENGTH:
        return None
    
    # Check for patterns that could cause catastrophic backtracking
    dangerous_patterns = [
        r'(.*)+',
        r'(.+)+',
        r'(\w+)+',
        r'(\d+)+',
        r'(.*)*',
        r'(.+)*',
    ]
    
    for pattern in dangerous_patterns:
        if pattern in regex_pattern:
            return None
    
    # Limit nesting depth
    if regex_pattern.count('(') > 10:
        return None
    
    try:
        # Try to compile the regex
        compiled = re.compile(regex_pattern)
        return compiled
    except (re.error, Exception):
        return None

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Handle process monitoring requests (CWE-703: proper exception handling)"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"code": 400, "message": "Content-Type must be application/json"}), 400
        
        # Parse JSON body with size limit (CWE-400: prevent resource exhaustion)
        request_data = request.get_data(as_text=True)
        if len(request_data) > 10000:  # 10KB limit
            return jsonify({"code": 400, "message": "Request body too large"}), 400
        
        try:
            data = json.loads(request_data)
        except json.JSONDecodeError:
            return jsonify({"code": 400, "message": "Invalid JSON in request body"}), 400
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', '')
        
        # Validate input types
        if not isinstance(command_regex, str):
            return jsonify({"code": 400, "message": "command_regex must be a string"}), 400
        if filter_flags and not isinstance(filter_flags, str):
            return jsonify({"code": 400, "message": "filter_flags must be a string"}), 400
        
        # Validate and compile regex pattern
        regex_pattern = validate_regex(command_regex)
        if regex_pattern is None:
            return jsonify({"code": 400, "message": "Invalid regex pattern"}), 400
        
        # Validate filter flags
        if filter_flags:
            validated_flags = validate_filter_flags(filter_flags)
            if validated_flags is None:
                return jsonify({"code": 400, "message": "Invalid filter flags"}), 400
        else:
            validated_flags = ""
        
        # Build ps command safely (CWE-78: prevent command injection)
        ps_command = ['ps']
        
        # Add validated flags
        if validated_flags:
            for flag_part in validated_flags.split():
                if flag_part.startswith('-'):
                    ps_command.append(flag_part)
                else:
                    ps_command.append(f'-{flag_part}')
        else:
            # Default to aux if no flags specified
            ps_command.append('-aux')
        
        # Execute ps command with strict limits
        try:
            result = subprocess.run(
                ps_command,
                capture_output=True,
                text=True,
                timeout=3,  # 3 second timeout
                check=False,
                env={'PATH': '/bin:/usr/bin'},  # Restricted PATH
            )
            
            if result.returncode != 0 and result.returncode != 1:
                # ps might return 1 if no processes match, which is OK
                return jsonify({"code": 500, "message": "Failed to retrieve process list"}), 500
            
            output = result.stdout
            
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Process listing timed out"}), 500
        except Exception:
            return jsonify({"code": 500, "message": "Failed to retrieve process list"}), 500
        
        # Parse ps output
        lines = output.strip().split('\n')
        processes = []
        
        # Maximum number of results to prevent memory exhaustion (CWE-400)
        MAX_RESULTS = 1000
        
        for line_num, line in enumerate(lines):
            # Skip empty lines
            if not line.strip():
                continue
            
            # Skip header line
            if line_num == 0 and ('PID' in line.upper() or 'USER' in line.upper()):
                continue
            
            # Apply regex
            try:
                # Limit line length to prevent excessive processing
                if len(line) > 5000:
                    continue
                
                if regex_pattern.search(line):
                    # Extract PID from the line
                    parts = line.split(None, 5)
                    
                    if len(parts) >= 2:
                        try:
                            # PID is typically in the second column
                            pid = int(parts[1])
                            
                            processes.append({
                                "processId": pid,
                                "processString": line.strip()[:2000]  # Limit string length
                            })
                            
                            if len(processes) >= MAX_RESULTS:
                                break
                                
                        except (ValueError, IndexError):
                            continue
            except Exception:
                continue
        
        return jsonify(processes), 200
        
    except Exception:
        # Generic error handler - don't expose details (CWE-209)
        return jsonify({"code": 500, "message": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)