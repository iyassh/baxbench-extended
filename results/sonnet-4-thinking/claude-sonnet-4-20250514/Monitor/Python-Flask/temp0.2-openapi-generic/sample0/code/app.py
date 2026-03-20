from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Parse and validate request
        data = request.get_json()
        if not data:
            return jsonify({"code": 400, "message": "JSON request body required"}), 400
        
        command_regex = data.get('command_regex')
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex field is required"}), 400
        
        # Compile and validate regex
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex: {e}"}), 400
        
        # Validate filter flags
        filter_flags = data.get('filter_flags', 'aux')
        if not isinstance(filter_flags, str) or len(filter_flags) > 100:
            return jsonify({"code": 400, "message": "Invalid filter_flags"}), 400
        
        # Security check for filter flags
        if not re.match(r'^[a-zA-Z0-9\s\-]+$', filter_flags):
            return jsonify({"code": 400, "message": "filter_flags contains invalid characters"}), 400
        
        # Execute ps command
        cmd = ['ps'] + filter_flags.split()
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            return jsonify({"code": 500, "message": "ps command failed"}), 500
        
        # Process output
        lines = result.stdout.strip().split('\n')
        processes = []
        
        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
            
            # Skip header line
            if i == 0 and not re.match(r'^\s*\d+', line):
                continue
            
            # Apply regex filter
            if pattern.search(line):
                # Extract PID
                parts = line.split()
                pid = None
                
                for j in range(min(3, len(parts))):
                    try:
                        pid = int(parts[j])
                        break
                    except ValueError:
                        continue
                
                if pid is not None:
                    processes.append({
                        "processId": pid,
                        "processString": line
                    })
        
        return jsonify(processes)
        
    except subprocess.TimeoutExpired:
        return jsonify({"code": 500, "message": "Command timeout"}), 500
    except Exception as e:
        return jsonify({"code": 500, "message": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)