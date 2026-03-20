from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

def sanitize_ps_flags(flags_str):
    """Sanitize ps flags to prevent command injection"""
    if not flags_str:
        return ""
    
    # Only allow alphanumeric, dash, and space
    sanitized = re.sub(r'[^a-zA-Z0-9\s\-]', '', flags_str)
    
    # Further validate individual flags
    parts = sanitized.split()
    valid_parts = []
    
    for part in parts:
        # Check if it's a valid flag format (starts with - or just letters)
        if part.startswith('-'):
            # Remove dangerous combinations
            if not any(danger in part for danger in ['&&', '||', ';', '|', '>', '<', '`', '$', '(', ')', '{', '}']):
                valid_parts.append(part)
        elif part.replace('-', '').isalpha():
            valid_parts.append(part)
    
    return ' '.join(valid_parts)

def validate_regex(pattern):
    """Validate regex pattern to prevent ReDoS attacks"""
    try:
        # Check for potentially dangerous patterns
        if len(pattern) > 1000:  # Limit regex length
            return None
        
        # Try to compile the regex
        compiled = re.compile(pattern)
        return compiled
    except re.error:
        return None

def get_processes(filter_flags=None, command_regex=None):
    """Get list of running processes matching the criteria"""
    try:
        # Build ps command
        cmd = ['ps']
        
        if filter_flags:
            sanitized_flags = sanitize_ps_flags(filter_flags)
            if sanitized_flags:
                # Split flags and add to command
                flag_parts = sanitized_flags.split()
                cmd.extend(flag_parts)
        else:
            # Default flags if none provided
            cmd.append('aux')
        
        # Execute ps command with timeout
        result = subprocess.run(
            cmd, 
            capture_output=True, 
            text=True, 
            timeout=5,
            env={'PATH': '/usr/bin:/bin'}  # Restrict PATH for security
        )
        
        if result.returncode != 0:
            return None, f"Error executing ps command: {result.stderr}"
        
        # Parse the output
        lines = result.stdout.strip().split('\n')
        
        if not lines:
            return [], None
        
        # Compile regex if provided
        regex = None
        if command_regex:
            regex = validate_regex(command_regex)
            if regex is None:
                return None, "Invalid regular expression"
        
        processes = []
        
        # Find PID column index from header
        header = lines[0] if lines else ""
        pid_index = -1
        
        # Try to find PID column
        header_parts = header.split()
        for i, part in enumerate(header_parts):
            if part.upper() == 'PID':
                pid_index = i
                break
        
        # If PID column not found, assume it's column 1 (0-indexed)
        if pid_index == -1:
            pid_index = 1
        
        # Parse each process line (skip header)
        for line in lines[1:]:
            if not line.strip():
                continue
            
            # Get the full process string
            process_string = line.strip()
            
            # Apply regex filter if provided
            if regex:
                if not regex.search(process_string):
                    continue
            
            # Extract PID
            parts = line.split(None, pid_index + 1)
            if len(parts) > pid_index:
                try:
                    pid = int(parts[pid_index])
                    processes.append({
                        'processId': pid,
                        'processString': process_string
                    })
                except (ValueError, IndexError):
                    # Skip lines where we can't parse PID
                    continue
        
        return processes, None
        
    except subprocess.TimeoutExpired:
        return None, "Process listing timed out"
    except Exception as e:
        return None, f"Error getting processes: {str(e)}"

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Endpoint to retrieve a list of running processes"""
    try:
        # Check content type
        if not request.is_json:
            return jsonify({
                'code': 400,
                'message': 'Content-Type must be application/json'
            }), 400
        
        data = request.get_json()
        
        # Validate required parameters
        if 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'command_regex is required'
            }), 400
        
        command_regex = data.get('command_regex')
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
        
        # Limit input sizes for security
        if len(command_regex) > 1000:
            return jsonify({
                'code': 400,
                'message': 'command_regex too long'
            }), 400
        
        if filter_flags and len(filter_flags) > 100:
            return jsonify({
                'code': 400,
                'message': 'filter_flags too long'
            }), 400
        
        # Get processes
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
def not_found(e):
    return jsonify({
        'code': 404,
        'message': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({
        'code': 405,
        'message': 'Method not allowed'
    }), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({
        'code': 500,
        'message': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)