from flask import Flask, request, jsonify
import subprocess
import re
import shlex

app = Flask(__name__)

def validate_ps_flags(flags):
    """Validate ps flags to prevent command injection"""
    if not flags:
        return True
    
    # Only allow alphanumeric characters, spaces, and hyphens
    if not re.match(r'^[a-zA-Z0-9\s\-]+$', flags):
        return False
    
    # Additional check for common ps flags
    allowed_flags = ['a', 'u', 'x', 'e', 'f', 'l', 'w', 'T', 'H', 'r', 'n', 'N', 'o', 'p', 'U', 'g', 'G']
    flag_chars = flags.replace('-', '').replace(' ', '')
    
    for char in flag_chars:
        if char not in allowed_flags:
            return False
    
    return True

def validate_regex(pattern):
    """Validate regex pattern"""
    try:
        re.compile(pattern)
        return True
    except re.error:
        return False

def get_processes(filter_flags=None, command_regex=None):
    """Get list of running processes matching the criteria"""
    try:
        # Build ps command
        cmd = ['ps']
        
        if filter_flags:
            # Validate flags to prevent injection
            if not validate_ps_flags(filter_flags):
                return None, "Invalid filter flags"
            
            # Parse flags safely
            flags = filter_flags.strip().split()
            for flag in flags:
                if flag:
                    cmd.append(flag)
        else:
            # Default flags if none provided
            cmd.extend(['aux'])
        
        # Execute ps command safely
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False
        )
        
        if result.returncode != 0:
            return None, f"Error executing ps command: {result.stderr}"
        
        # Parse output
        lines = result.stdout.strip().split('\n')
        if not lines:
            return [], None
        
        # Skip header line
        header = lines[0]
        process_lines = lines[1:]
        
        # Compile regex pattern
        if not validate_regex(command_regex):
            return None, "Invalid regex pattern"
        
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return None, f"Invalid regex pattern: {str(e)}"
        
        # Filter processes
        matching_processes = []
        for line in process_lines:
            if not line.strip():
                continue
            
            # Check if command matches regex
            if pattern.search(line):
                # Extract PID (second column in most ps outputs)
                parts = line.split(None, 10)  # Split into max 11 parts
                if len(parts) >= 2:
                    try:
                        pid = int(parts[1])
                        matching_processes.append({
                            'processId': pid,
                            'processString': line.strip()
                        })
                    except (ValueError, IndexError):
                        # Skip lines where PID cannot be extracted
                        continue
        
        return matching_processes, None
        
    except subprocess.TimeoutExpired:
        return None, "Command execution timeout"
    except Exception as e:
        return None, f"Error getting processes: {str(e)}"

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Endpoint to retrieve list of running processes"""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({
                'code': 400,
                'message': 'Content-Type must be application/json'
            }), 400
        
        # Get request data
        data = request.get_json()
        
        if not data:
            return jsonify({
                'code': 400,
                'message': 'Invalid JSON data'
            }), 400
        
        # Validate required fields
        if 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'Missing required field: command_regex'
            }), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', None)
        
        # Validate command_regex is a string
        if not isinstance(command_regex, str):
            return jsonify({
                'code': 400,
                'message': 'command_regex must be a string'
            }), 400
        
        # Validate filter_flags if provided
        if filter_flags is not None and not isinstance(filter_flags, str):
            return jsonify({
                'code': 400,
                'message': 'filter_flags must be a string'
            }), 400
        
        # Get matching processes
        processes, error = get_processes(filter_flags, command_regex)
        
        if error:
            return jsonify({
                'code': 500,
                'message': error
            }), 500
        
        return jsonify(processes), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'Internal server error: {str(e)}'
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'code': 404,
        'message': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({
        'code': 405,
        'message': 'Method not allowed'
    }), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'code': 500,
        'message': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)