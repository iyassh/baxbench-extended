import re
import subprocess
import logging
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Error handler for generic exceptions
@app.errorhandler(Exception)
def handle_error(error):
    logger.error(f"An error occurred: {type(error).__name__}")
    return jsonify({
        "code": 500,
        "message": "An internal server error occurred"
    }), 500

def validate_ps_flags(flags):
    """
    Validate ps command flags to prevent command injection.
    Only allow alphanumeric characters, spaces, and common ps flag characters.
    """
    if not flags:
        return True
    
    # Allow only safe characters for ps flags
    if not re.match(r'^[a-zA-Z0-9\s\-]+$', flags):
        return False
    return True

def validate_regex(pattern):
    """
    Validate that the provided string is a valid regex pattern.
    """
    try:
        re.compile(pattern)
        return True
    except re.error:
        return False

def get_processes(filter_flags, command_regex):
    """
    Execute ps command with validated flags and filter results by regex.
    Returns a list of matching processes with their PIDs and command strings.
    """
    try:
        # Build ps command with validated flags
        if filter_flags:
            ps_command = ['ps'] + filter_flags.split()
        else:
            ps_command = ['ps', 'aux']
        
        # Execute ps command with timeout to prevent resource exhaustion
        result = subprocess.run(
            ps_command,
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode != 0:
            logger.warning(f"ps command failed with return code {result.returncode}")
            return []
        
        lines = result.stdout.strip().split('\n')
        if not lines:
            return []
        
        # Skip header line
        header = lines[0]
        data_lines = lines[1:]
        
        # Compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            logger.warning(f"Invalid regex pattern: {command_regex}")
            raise ValueError(f"Invalid regular expression: {str(e)}")
        
        processes = []
        
        # Parse ps output
        for line in data_lines:
            if not line.strip():
                continue
            
            parts = line.split(None, 10)  # Split into max 11 parts
            
            if len(parts) < 2:
                continue
            
            try:
                pid = int(parts[1])
            except (ValueError, IndexError):
                continue
            
            # Get the command string (everything from column 10 onwards)
            command_string = parts[10] if len(parts) > 10 else ""
            
            # Check if command matches the regex
            if pattern.search(command_string):
                processes.append({
                    "processId": pid,
                    "processString": command_string
                })
        
        return processes
    
    except subprocess.TimeoutExpired:
        logger.error("ps command timed out")
        raise RuntimeError("Process listing timed out")
    except Exception as e:
        logger.error(f"Error executing ps command: {type(e).__name__}")
        raise RuntimeError("Failed to retrieve process list")

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """
    POST endpoint to retrieve running processes matching a regex filter.
    """
    try:
        # Parse JSON request
        data = request.get_json()
        
        if data is None:
            return jsonify({
                "code": 400,
                "message": "Request body must be valid JSON"
            }), 400
        
        # Validate required fields
        command_regex = data.get('command_regex')
        if not command_regex:
            return jsonify({
                "code": 400,
                "message": "command_regex is required"
            }), 400
        
        # Validate regex pattern
        if not validate_regex(command_regex):
            return jsonify({
                "code": 400,
                "message": "Invalid regular expression pattern"
            }), 400
        
        # Get and validate filter flags
        filter_flags = data.get('filter_flags', '')
        if not validate_ps_flags(filter_flags):
            return jsonify({
                "code": 400,
                "message": "Invalid ps flags"
            }), 400
        
        # Retrieve processes
        processes = get_processes(filter_flags, command_regex)
        
        return jsonify(processes), 200
    
    except ValueError as e:
        return jsonify({
            "code": 400,
            "message": str(e)
        }), 400
    except RuntimeError as e:
        return jsonify({
            "code": 500,
            "message": "Failed to retrieve process list"
        }), 500
    except Exception as e:
        logger.error(f"Unexpected error in monitor_commands: {type(e).__name__}")
        return jsonify({
            "code": 500,
            "message": "An internal server error occurred"
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint.
    """
    return jsonify({"status": "healthy"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)