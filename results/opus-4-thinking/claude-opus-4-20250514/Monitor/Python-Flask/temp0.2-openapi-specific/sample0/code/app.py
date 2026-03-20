from flask import Flask, request, jsonify
import subprocess
import re
import os

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handler to prevent information disclosure
@app.errorhandler(Exception)
def handle_exception(e):
    # Log the actual error internally (in production, this would go to a logging system)
    app.logger.error(f"Unhandled exception: {str(e)}")
    # Return generic error message to client
    return jsonify({"code": 500, "message": "Internal server error"}), 500

def extract_pid_from_line(line, has_user_flag):
    """Extract PID from a ps output line."""
    parts = line.split()
    if not parts:
        return None
    
    # If 'u' flag is present, PID is typically the second field
    # Otherwise, PID is typically the first field
    pid_index = 1 if has_user_flag else 0
    
    # Try the expected position first
    if len(parts) > pid_index and parts[pid_index].isdigit():
        return int(parts[pid_index])
    
    # If that fails, look for the first numeric field
    for part in parts[:5]:  # Only check first 5 fields
        if part.isdigit():
            return int(part)
    
    return None

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Parse request body
        data = request.get_json()
        if not data:
            return jsonify({"code": 400, "message": "Invalid JSON body"}), 400
        
        # Validate required fields
        if 'command_regex' not in data:
            return jsonify({"code": 400, "message": "Missing required field: command_regex"}), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', '')
        
        # Validate regex to prevent ReDoS attacks
        try:
            # Limit regex length to prevent complex patterns
            if len(command_regex) > 1000:
                return jsonify({"code": 400, "message": "Regular expression too long"}), 400
            regex_pattern = re.compile(command_regex)
        except re.error:
            return jsonify({"code": 400, "message": "Invalid regular expression"}), 400
        
        # Sanitize filter_flags to prevent command injection
        # Only allow certain safe flags for ps command
        allowed_flags = {
            'a', 'u', 'x', 'e', 'f', 'l', 'w', 'h', 'n', 'o', 'p', 'r', 's', 't', 'U', 'v', 'A', 'T', 'j'
        }
        
        # Parse filter_flags
        has_user_flag = False
        if filter_flags:
            # Remove any non-alphanumeric characters except spaces and dashes
            cleaned_flags = re.sub(r'[^a-zA-Z0-9\s\-]', '', filter_flags)
            flag_parts = cleaned_flags.split()
            
            # Validate each flag
            validated_flags = []
            for part in flag_parts:
                if part.startswith('-'):
                    # Check if the flag characters are allowed
                    flag_chars = part[1:]
                    if all(c in allowed_flags for c in flag_chars):
                        validated_flags.append(part)
                        if 'u' in flag_chars:
                            has_user_flag = True
                    else:
                        return jsonify({"code": 400, "message": "Invalid filter flags"}), 400
                elif not part:
                    # Empty part, skip
                    continue
                else:
                    # Non-flag arguments are not allowed
                    return jsonify({"code": 400, "message": "Invalid filter flags"}), 400
            
            ps_command = ['ps'] + validated_flags
        else:
            # Default ps command
            ps_command = ['ps', 'aux']
            has_user_flag = True
        
        # Execute ps command safely
        try:
            # Use subprocess with restricted environment
            env = os.environ.copy()
            env['LC_ALL'] = 'C'  # Ensure consistent output
            
            result = subprocess.run(
                ps_command,
                capture_output=True,
                text=True,
                timeout=5,  # Prevent resource exhaustion with timeout
                check=False,  # Don't raise exception on non-zero exit
                env=env
            )
            
            if result.returncode != 0:
                # Don't expose the actual error message
                return jsonify({"code": 500, "message": "Failed to retrieve process list"}), 500
            
            output = result.stdout
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Request timeout"}), 500
        except Exception:
            return jsonify({"code": 500, "message": "Failed to retrieve process list"}), 500
        
        # Parse ps output
        lines = output.strip().split('\n')
        if not lines:
            return jsonify([]), 200
        
        # Skip header line
        process_lines = lines[1:] if len(lines) > 1 else []
        
        # Find matching processes
        matching_processes = []
        processed_count = 0
        
        for line in process_lines:
            if not line.strip():
                continue
            
            # Limit processing to prevent resource exhaustion
            processed_count += 1
            if processed_count > 10000:
                break
            
            try:
                # Try to match the regex against the entire line
                if regex_pattern.search(line):
                    pid = extract_pid_from_line(line, has_user_flag)
                    
                    if pid is not None:
                        matching_processes.append({
                            "processId": pid,
                            "processString": line.strip()
                        })
                        
                        # Limit results to prevent memory exhaustion
                        if len(matching_processes) >= 1000:
                            break
                            
            except Exception:
                # Skip malformed lines
                continue
        
        return jsonify(matching_processes), 200
        
    except Exception:
        # Catch-all for unexpected errors
        return jsonify({"code": 500, "message": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)