import re
import subprocess
import json
from flask import Flask, request, jsonify

app = Flask(__name__)


def parse_ps_output(ps_output):
    """Parse ps command output and return list of processes."""
    lines = ps_output.strip().split('\n')
    if len(lines) < 2:
        return []
    
    processes = []
    header = lines[0].split()
    
    # Find the index of PID and COMMAND columns
    pid_index = None
    command_index = None
    
    for i, col in enumerate(header):
        if col == 'PID':
            pid_index = i
        elif col == 'COMMAND':
            command_index = i
    
    # If COMMAND column not found, use the last column or reconstruct from remaining text
    if command_index is None:
        command_index = len(header) - 1
    
    # Parse each process line
    for line in lines[1:]:
        parts = line.split(None, command_index)
        
        if len(parts) > command_index and pid_index is not None:
            try:
                pid = int(parts[pid_index])
                # Get command as everything from command_index onwards
                if len(parts) > command_index:
                    command = parts[command_index]
                else:
                    command = ""
                
                processes.append({
                    'processId': pid,
                    'processString': command
                })
            except (ValueError, IndexError):
                continue
    
    return processes


def get_processes(filter_flags=None):
    """Execute ps command and return parsed output."""
    try:
        cmd = ['ps']
        if filter_flags:
            # Split filter_flags safely
            flags = filter_flags.split()
            cmd.extend(flags)
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode != 0:
            return None, f"ps command failed: {result.stderr}"
        
        processes = parse_ps_output(result.stdout)
        return processes, None
    except subprocess.TimeoutExpired:
        return None, "ps command timed out"
    except Exception as e:
        return None, f"Error executing ps command: {str(e)}"


def filter_processes_by_regex(processes, command_regex):
    """Filter processes by command regex pattern."""
    try:
        pattern = re.compile(command_regex)
    except re.error as e:
        return None, f"Invalid regular expression: {str(e)}"
    
    filtered = []
    for process in processes:
        if pattern.search(process['processString']):
            filtered.append(process)
    
    return filtered, None


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Endpoint to retrieve processes matching a filter criterion."""
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({
                'code': 400,
                'message': 'Request body must be valid JSON'
            }), 400
        
        # Validate required field
        command_regex = data.get('command_regex')
        if command_regex is None:
            return jsonify({
                'code': 400,
                'message': 'command_regex is required'
            }), 400
        
        if not isinstance(command_regex, str):
            return jsonify({
                'code': 400,
                'message': 'command_regex must be a string'
            }), 400
        
        filter_flags = data.get('filter_flags')
        if filter_flags is not None and not isinstance(filter_flags, str):
            return jsonify({
                'code': 400,
                'message': 'filter_flags must be a string'
            }), 400
        
        # Get processes
        processes, error = get_processes(filter_flags)
        if error:
            return jsonify({
                'code': 500,
                'message': error
            }), 500
        
        # Filter by regex
        filtered_processes, error = filter_processes_by_regex(processes, command_regex)
        if error:
            return jsonify({
                'code': 400,
                'message': error
            }), 400
        
        return jsonify(filtered_processes), 200
    
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'Internal server error: {str(e)}'
        }), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({
        'code': 404,
        'message': 'Endpoint not found'
    }), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({
        'code': 405,
        'message': 'Method not allowed'
    }), 405


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)