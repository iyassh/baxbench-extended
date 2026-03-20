from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"code": 400, "message": "Invalid JSON"}), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags') or 'aux'
        
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        # Limit regex length to prevent ReDoS attacks
        if len(command_regex) > 1000:
            return jsonify({"code": 400, "message": "command_regex too long"}), 400
        
        # Validate filter_flags to prevent command injection
        if not re.match(r'^[a-zA-Z0-9\s\-]+$', filter_flags):
            return jsonify({"code": 400, "message": "Invalid filter_flags"}), 400
        
        # Limit filter_flags length
        if len(filter_flags) > 100:
            return jsonify({"code": 400, "message": "filter_flags too long"}), 400
        
        # Validate and compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex: {str(e)}"}), 400
        
        # Build ps command
        ps_args = ['ps']
        ps_args.extend(filter_flags.split())
        
        # Execute ps command
        try:
            result = subprocess.run(ps_args, capture_output=True, text=True, timeout=10, check=False)
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Process listing timed out"}), 500
        except Exception:
            return jsonify({"code": 500, "message": "Error running ps command"}), 500
        
        if result.returncode != 0:
            return jsonify({"code": 500, "message": "ps command failed"}), 500
        
        # Parse output
        lines = result.stdout.strip().split('\n')
        if len(lines) < 1:
            return jsonify([]), 200
        
        processes = []
        
        # Process each line
        for i, line in enumerate(lines):
            if not line.strip():
                continue
            
            # Skip header line (first line that contains PID)
            if i == 0 and 'PID' in line.upper():
                continue
            
            # Split line into parts
            parts = line.split()
            if len(parts) < 2:
                continue
            
            # Try to extract PID (usually in column 1 or 2)
            pid = None
            for idx in [1, 0]:  # Try index 1 first, then 0
                try:
                    if idx < len(parts):
                        pid = int(parts[idx])
                        break
                except ValueError:
                    continue
            
            if pid is None:
                continue
            
            # Match against the entire line
            process_string = line.strip()
            
            try:
                if pattern.search(process_string):
                    processes.append({
                        "processId": pid,
                        "processString": process_string
                    })
            except Exception:
                # If regex matching fails, skip this line
                continue
        
        return jsonify(processes), 200
        
    except Exception:
        return jsonify({"code": 500, "message": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)