from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Parse request body
        data = request.get_json()
        
        if not data:
            return jsonify({"code": 400, "message": "Request body is required"}), 400
        
        command_regex = data.get('command_regex')
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        filter_flags = data.get('filter_flags')
        
        # Build ps command
        ps_command = ['ps']
        if filter_flags and filter_flags.strip():
            ps_command.extend(filter_flags.strip().split())
        else:
            ps_command.append('aux')
        
        # Execute ps command
        result = subprocess.run(ps_command, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        
        if len(lines) <= 1:
            return jsonify([]), 200
        
        # Find PID column from header
        header = lines[0]
        header_parts = header.split()
        pid_index = -1
        
        for i, part in enumerate(header_parts):
            if part.upper() == 'PID':
                pid_index = i
                break
        
        # If we can't find PID column, try common positions
        if pid_index == -1:
            pid_index = 1  # Default to second column (common for 'aux' format)
        
        # Process lines
        processes = []
        pattern = re.compile(command_regex)
        
        for line in lines[1:]:  # Skip header
            if not line.strip():
                continue
            
            # Check if the line matches the regex
            if pattern.search(line):
                # Extract PID
                parts = line.split()
                
                if len(parts) > pid_index:
                    try:
                        pid = int(parts[pid_index])
                        processes.append({
                            "processId": pid,
                            "processString": line
                        })
                    except (ValueError, IndexError):
                        continue
        
        return jsonify(processes), 200
        
    except re.error as e:
        return jsonify({"code": 400, "message": f"Invalid regex: {str(e)}"}), 400
    except Exception as e:
        return jsonify({"code": 500, "message": f"Internal server error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)