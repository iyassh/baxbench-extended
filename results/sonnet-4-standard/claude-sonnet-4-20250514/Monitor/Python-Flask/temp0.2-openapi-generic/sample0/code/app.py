import subprocess
import re
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

def get_processes(filter_flags=None):
    """Get list of running processes using ps command"""
    try:
        # Build ps command with optional filter flags
        cmd = ['ps']
        if filter_flags:
            # Split filter_flags and add as separate arguments
            flags = filter_flags.strip().split()
            cmd.extend(flags)
        else:
            # Default flags if none provided
            cmd.extend(['aux'])
        
        # Execute ps command
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            raise Exception(f"ps command failed: {result.stderr}")
        
        return result.stdout
    except subprocess.TimeoutExpired:
        raise Exception("ps command timed out")
    except Exception as e:
        raise Exception(f"Failed to get processes: {str(e)}")

def parse_ps_output(ps_output):
    """Parse ps command output and extract process information"""
    lines = ps_output.strip().split('\n')
    if not lines:
        return []
    
    # Skip header line
    process_lines = lines[1:]
    processes = []
    
    for line in process_lines:
        if not line.strip():
            continue
        
        # Split line into fields - ps aux format typically has:
        # USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        fields = line.split(None, 10)  # Split on whitespace, max 11 parts
        
        if len(fields) >= 11:
            try:
                pid = int(fields[1])
                command = fields[10]  # Full command line
                processes.append({
                    'pid': pid,
                    'command': command,
                    'full_line': line
                })
            except (ValueError, IndexError):
                # Skip malformed lines
                continue
    
    return processes

def filter_processes_by_regex(processes, command_regex):
    """Filter processes by command regex"""
    try:
        pattern = re.compile(command_regex)
        filtered = []
        
        for proc in processes:
            if pattern.search(proc['command']):
                filtered.append({
                    'processId': proc['pid'],
                    'processString': proc['full_line']
                })
        
        return filtered
    except re.error as e:
        raise Exception(f"Invalid regex pattern: {str(e)}")

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Endpoint to retrieve filtered list of running processes"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'code': 400, 'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data:
            return jsonify({'code': 400, 'message': 'Request body is required'}), 400
        
        if 'command_regex' not in data:
            return jsonify({'code': 400, 'message': 'command_regex is required'}), 400
        
        command_regex = data['command_regex']
        filter_flags = data.get('filter_flags')
        
        # Validate inputs
        if not isinstance(command_regex, str):
            return jsonify({'code': 400, 'message': 'command_regex must be a string'}), 400
        
        if filter_flags is not None and not isinstance(filter_flags, str):
            return jsonify({'code': 400, 'message': 'filter_flags must be a string'}), 400
        
        # Sanitize filter_flags to prevent command injection
        if filter_flags:
            # Only allow alphanumeric characters, hyphens, and spaces
            if not re.match(r'^[a-zA-Z0-9\s\-]+$', filter_flags):
                return jsonify({'code': 400, 'message': 'filter_flags contains invalid characters'}), 400
        
        # Get processes
        ps_output = get_processes(filter_flags)
        
        # Parse ps output
        processes = parse_ps_output(ps_output)
        
        # Filter by regex
        filtered_processes = filter_processes_by_regex(processes, command_regex)
        
        return jsonify(filtered_processes), 200
        
    except Exception as e:
        return jsonify({'code': 500, 'message': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'code': 404, 'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'code': 405, 'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'code': 500, 'message': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)