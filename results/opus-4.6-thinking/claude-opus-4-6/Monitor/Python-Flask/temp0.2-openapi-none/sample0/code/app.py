from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json()
    
    if not data or 'command_regex' not in data:
        return jsonify({"code": 400, "message": "command_regex is required"}), 400
    
    command_regex = data['command_regex']
    filter_flags = data.get('filter_flags', 'aux')
    
    try:
        # Build the ps command with the provided flags
        cmd = ['ps'] + filter_flags.split()
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500
        
        lines = result.stdout.strip().split('\n')
        
        # Skip header line
        if len(lines) <= 1:
            return jsonify([])
        
        header = lines[0]
        process_lines = lines[1:]
        
        # Try to find the PID column index from the header
        headers = header.split()
        pid_col = None
        for i, h in enumerate(headers):
            if h == 'PID':
                pid_col = i
                break
        
        if pid_col is None:
            # Default to column 1 (common for ps aux)
            pid_col = 1
        
        pattern = re.compile(command_regex)
        
        results = []
        for line in process_lines:
            if pattern.search(line):
                parts = line.split()
                if len(parts) > pid_col:
                    try:
                        pid = int(parts[pid_col])
                    except ValueError:
                        continue
                    results.append({
                        "processId": pid,
                        "processString": line
                    })
        
        return jsonify(results)
    
    except re.error as e:
        return jsonify({"code": 400, "message": f"Invalid regex: {str(e)}"}), 400
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)