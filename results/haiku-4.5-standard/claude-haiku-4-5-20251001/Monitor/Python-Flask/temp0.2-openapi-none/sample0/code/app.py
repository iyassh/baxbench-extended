from flask import Flask, request, jsonify
import subprocess
import re
import json

app = Flask(__name__)


def parse_ps_output(ps_output):
    """Parse ps command output and return list of processes with PID and command."""
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
    
    # Parse data lines
    for line in lines[1:]:
        parts = line.split(None, command_index)
        if len(parts) > command_index:
            try:
                pid = int(parts[pid_index])
                # Get everything from command_index onwards as the command string
                command = ' '.join(parts[command_index:]) if command_index < len(parts) else parts[-1]
                processes.append({
                    'pid': pid,
                    'command': command
                })
            except (ValueError, IndexError):
                continue
    
    return processes


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """
    Retrieve a list of running processes matching a regex filter.
    
    Request body:
    {
        "filter_flags": "aux -T" (optional),
        "command_regex": "ps.*" (required)
    }
    
    Returns:
    [
        {
            "processId": 1234,
            "processString": "python script.py"
        }
    ]
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'code': 400,
                'message': 'Request body must be JSON'
            }), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', 'aux')
        
        if not command_regex:
            return jsonify({
                'code': 400,
                'message': 'command_regex is required'
            }), 400
        
        # Validate regex
        try:
            regex_pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({
                'code': 400,
                'message': f'Invalid regular expression: {str(e)}'
            }), 400
        
        # Build ps command
        ps_cmd = ['ps'] + filter_flags.split()
        
        try:
            result = subprocess.run(ps_cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                return jsonify({
                    'code': 500,
                    'message': f'ps command failed: {result.stderr}'
                }), 500
            
            ps_output = result.stdout
        except subprocess.TimeoutExpired:
            return jsonify({
                'code': 500,
                'message': 'ps command timed out'
            }), 500
        except Exception as e:
            return jsonify({
                'code': 500,
                'message': f'Error executing ps command: {str(e)}'
            }), 500
        
        # Parse ps output
        processes = parse_ps_output(ps_output)
        
        # Filter processes by regex
        matching_processes = []
        for proc in processes:
            if regex_pattern.search(proc['command']):
                matching_processes.append({
                    'processId': proc['pid'],
                    'processString': proc['command']
                })
        
        return jsonify(matching_processes), 200
    
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)