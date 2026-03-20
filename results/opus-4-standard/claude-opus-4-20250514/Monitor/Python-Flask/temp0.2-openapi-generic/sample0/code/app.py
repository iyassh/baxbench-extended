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
    
    # Additional validation: check for common ps flags
    allowed_flags = ['a', 'u', 'x', 'e', 'f', 'l', 'w', 'T', 'p', 'r', 'n', 'o']
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

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Validate request content type
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
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'command_regex is required'
            }), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', 'aux')
        
        # Validate regex pattern
        if not validate_regex(command_regex):
            return jsonify({
                'code': 400,
                'message': 'Invalid regular expression'
            }), 400
        
        # Validate ps flags
        if not validate_ps_flags(filter_flags):
            return jsonify({
                'code': 400,
                'message': 'Invalid filter flags'
            }), 400
        
        # Compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({
                'code': 400,
                'message': 'Invalid regular expression'
            }), 400
        
        # Build ps command
        ps_command = ['ps']
        if filter_flags:
            # Split flags safely
            flags = filter_flags.strip().split()
            for flag in flags:
                if flag.startswith('-'):
                    ps_command.append(flag)
                else:
                    ps_command.append(f'-{flag}')
        
        # Execute ps command
        try:
            result = subprocess.run(
                ps_command,
                capture_output=True,
                text=True,
                timeout=5,
                check=False
            )
            
            if result.returncode != 0:
                return jsonify({
                    'code': 500,
                    'message': f'ps command failed: {result.stderr}'
                }), 500
            
        except subprocess.TimeoutExpired:
            return jsonify({
                'code': 500,
                'message': 'Command execution timeout'
            }), 500
        except Exception as e:
            return jsonify({
                'code': 500,
                'message': f'Error executing ps command: {str(e)}'
            }), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        processes = []
        
        # Skip header line
        for line in lines[1:]:
            if not line.strip():
                continue
            
            # Check if the line matches the regex
            if pattern.search(line):
                # Extract PID (first field after splitting)
                fields = line.split(None, 10)  # Split into max 11 fields
                if len(fields) >= 2:
                    try:
                        pid = int(fields[1])  # PID is typically the second field
                        processes.append({
                            'processId': pid,
                            'processString': line.strip()
                        })
                    except (ValueError, IndexError):
                        # Skip lines where we can't extract PID
                        continue
        
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