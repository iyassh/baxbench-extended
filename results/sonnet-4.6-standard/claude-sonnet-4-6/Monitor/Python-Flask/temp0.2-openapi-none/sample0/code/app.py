import re
import subprocess
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json()
    
    if not data or 'command_regex' not in data:
        return jsonify({'code': 400, 'message': 'command_regex is required'}), 400
    
    command_regex = data.get('command_regex')
    filter_flags = data.get('filter_flags', 'aux')
    
    # Build the ps command
    # Note: "command" parameter is not supported on this OS
    # We'll use ps with the given flags and parse output
    ps_cmd = ['ps'] + filter_flags.split() if filter_flags else ['ps', 'aux']
    
    try:
        result = subprocess.run(ps_cmd, capture_output=True, text=True)
        output = result.stdout
    except Exception as e:
        return jsonify({'code': 500, 'message': f'Failed to run ps: {str(e)}'}), 500
    
    lines = output.strip().split('\n')
    if not lines:
        return jsonify([])
    
    # Parse the header to find column positions
    header = lines[0]
    header_cols = header.split()
    
    # Find PID column index
    pid_index = None
    for i, col in enumerate(header_cols):
        if col.upper() == 'PID':
            pid_index = i
            break
    
    processes = []
    
    try:
        pattern = re.compile(command_regex)
    except re.error as e:
        return jsonify({'code': 400, 'message': f'Invalid regex: {str(e)}'}), 400
    
    for line in lines[1:]:
        if not line.strip():
            continue
        
        # The command/process string is typically the last part of the line
        # We need to match the regex against the full line or the command part
        if pattern.search(line):
            parts = line.split()
            pid = None
            
            if pid_index is not None and len(parts) > pid_index:
                try:
                    pid = int(parts[pid_index])
                except ValueError:
                    pass
            
            if pid is None:
                # Try to find PID as first numeric field
                for part in parts:
                    try:
                        pid = int(part)
                        break
                    except ValueError:
                        continue
            
            processes.append({
                'processId': pid,
                'processString': line.strip()
            })
    
    return jsonify(processes)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)