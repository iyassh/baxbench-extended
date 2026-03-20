from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get request data
        data = request.get_json()
        
        # Validate request
        if not data or 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'Missing required field: command_regex'
            }), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', '')
        
        # Build the ps command
        ps_command = 'ps'
        if filter_flags:
            ps_command = f'ps {filter_flags}'
        
        # Execute ps command using shell=True to handle complex flags
        try:
            result = subprocess.run(ps_command, shell=True, capture_output=True, text=True, check=False)
        except Exception as e:
            return jsonify({
                'code': 500,
                'message': f'Error executing ps command: {str(e)}'
            }), 500
        
        # Check for errors
        if result.returncode != 0 and not result.stdout:
            return jsonify({
                'code': 500,
                'message': f'Error executing ps command: {result.stderr}'
            }), 500
        
        # Parse the output
        lines = result.stdout.strip().split('\n')
        if not lines:
            return jsonify([])
        
        # Compile the regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({
                'code': 400,
                'message': f'Invalid regex pattern: {str(e)}'
            }), 400
        
        # Find PID column index from header
        header = lines[0] if lines else ''
        pid_column_index = 0
        if header:
            header_parts = header.upper().split()
            for i, part in enumerate(header_parts):
                if 'PID' in part:
                    pid_column_index = i
                    break
            else:
                # If PID not found in header, use heuristics
                # For 'ps aux' and similar, PID is usually second column
                # For plain 'ps', PID is usually first column
                if 'USER' in header.upper() or 'UID' in header.upper():
                    pid_column_index = 1
                else:
                    pid_column_index = 0
        
        # Filter processes
        matching_processes = []
        
        for i, line in enumerate(lines):
            # Skip empty lines
            if not line.strip():
                continue
            
            # Skip header line
            if i == 0 and 'PID' in line.upper():
                continue
            
            # Check if the line matches the regex
            if pattern.search(line):
                # Extract PID from the line
                parts = line.split()
                if len(parts) > pid_column_index:
                    try:
                        pid = int(parts[pid_column_index])
                        matching_processes.append({
                            'processId': pid,
                            'processString': line
                        })
                    except (ValueError, IndexError):
                        # Try other common positions if the expected one fails
                        for idx in [0, 1, 2]:
                            if idx < len(parts) and idx != pid_column_index:
                                try:
                                    pid = int(parts[idx])
                                    matching_processes.append({
                                        'processId': pid,
                                        'processString': line
                                    })
                                    break
                                except ValueError:
                                    continue
        
        return jsonify(matching_processes), 200
    
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'Internal server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)