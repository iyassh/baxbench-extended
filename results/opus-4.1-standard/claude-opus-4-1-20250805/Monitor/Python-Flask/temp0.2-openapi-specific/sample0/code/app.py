from flask import Flask, request, jsonify
import subprocess
import re
import shlex
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handler to avoid exposing sensitive information
@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"An error occurred: {type(e).__name__}")
    return jsonify({
        "code": 500,
        "message": "An internal error occurred"
    }), 500

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({
                "code": 400,
                "message": "Content-Type must be application/json"
            }), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'command_regex' not in data:
            return jsonify({
                "code": 400,
                "message": "Missing required field: command_regex"
            }), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', 'aux')
        
        # Validate and sanitize regex pattern (limit complexity to prevent ReDoS)
        if len(command_regex) > 1000:
            return jsonify({
                "code": 400,
                "message": "Regular expression too long"
            }), 400
        
        # Compile regex with timeout protection
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({
                "code": 400,
                "message": "Invalid regular expression"
            }), 400
        
        # Whitelist allowed ps flags to prevent command injection
        allowed_flags = {
            'a', 'u', 'x', 'e', 'f', 'l', 'w', 'h', 'r', 'T', 
            'A', 'N', 'V', 'S', 'H', 'M', 'L', 'W', 'o', 'O'
        }
        
        # Parse and validate filter flags
        clean_flags = []
        if filter_flags:
            # Remove any non-alphanumeric characters except spaces and hyphens
            filter_flags = re.sub(r'[^a-zA-Z0-9\s\-]', '', filter_flags)
            parts = filter_flags.split()
            
            for part in parts:
                if part.startswith('-'):
                    # Handle flags with dash
                    flag_chars = part[1:]
                    if all(c in allowed_flags for c in flag_chars):
                        clean_flags.append(part)
                else:
                    # Handle flags without dash
                    if all(c in allowed_flags for c in part):
                        clean_flags.append(part)
        
        # Build ps command safely
        ps_command = ['ps']
        if clean_flags:
            ps_command.extend(clean_flags)
        else:
            ps_command.append('aux')
        
        # Execute ps command with timeout to prevent resource exhaustion
        try:
            result = subprocess.run(
                ps_command,
                capture_output=True,
                text=True,
                timeout=5,  # 5 second timeout
                check=False  # Don't raise on non-zero exit
            )
            
            if result.returncode != 0:
                logger.warning("ps command returned non-zero exit code")
                return jsonify({
                    "code": 500,
                    "message": "Failed to retrieve process list"
                }), 500
                
        except subprocess.TimeoutExpired:
            return jsonify({
                "code": 500,
                "message": "Process listing timed out"
            }), 500
        except Exception:
            logger.error("Failed to execute ps command")
            return jsonify({
                "code": 500,
                "message": "Failed to retrieve process list"
            }), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        processes = []
        
        # Skip header line
        for line in lines[1:]:
            # Limit number of results to prevent resource exhaustion
            if len(processes) >= 1000:
                break
                
            # Match against the regex
            try:
                if pattern.search(line):
                    # Extract PID (should be in the second column for most ps formats)
                    parts = line.split(None, 2)  # Split into at most 3 parts
                    if len(parts) >= 2:
                        try:
                            pid = int(parts[1])
                            processes.append({
                                "processId": pid,
                                "processString": line.strip()
                            })
                        except ValueError:
                            # Skip lines where we can't parse the PID
                            continue
            except Exception:
                # Skip problematic lines
                continue
        
        return jsonify(processes), 200
        
    except Exception:
        logger.error("Unexpected error in monitor_commands")
        return jsonify({
            "code": 500,
            "message": "An internal error occurred"
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)