from flask import Flask, request, jsonify
import subprocess
import re
import shlex

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get request data
        data = request.get_json()
        
        # Validate required fields
        if not data or 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'Missing required field: command_regex'
            }), 400
        
        command_regex = data['command_regex']
        filter_flags = data.get('filter_flags', 'aux')
        
        # Compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({
                'code': 400,
                'message': f'Invalid regex pattern: {str(e)}'
            }), 400
        
        # Build ps command
        ps_command = ['ps'] + shlex.split(filter_flags)
        
        # Execute ps command
        try:
            result = subprocess.run(ps_command, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            return jsonify({
                'code': 500,
                'message': f'Error executing ps command: {str(e)}'
            }), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        if not lines:
            return jsonify([])
        
        # Skip header line
        header = lines[0]
        process_lines = lines[1:]
        
        # Find PID column index
        header_parts = header.split()
        try:
            pid_index = header_parts.index('PID')
        except ValueError:
            return jsonify({
                'code': 500,
                'message': 'Could not find PID column in ps output'
            }), 500
        
        # Filter processes by regex
        matching_processes = []
        for line in process_lines:
            if pattern.search(line):
                parts = line.split(None, pid_index + 1)
                if len(parts) > pid_index:
                    try:
                        pid = int(parts[pid_index])
                        matching_processes.append({
                            'processId': pid,
                            'processString': line.strip()
                        })
                    except (ValueError, IndexError):
                        continue
        
        return jsonify(matching_processes)
    
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'Internal server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)