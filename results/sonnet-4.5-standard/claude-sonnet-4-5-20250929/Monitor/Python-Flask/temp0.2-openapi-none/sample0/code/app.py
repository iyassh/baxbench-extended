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
            return jsonify({"code": 400, "message": "Invalid JSON"}), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', 'aux')
        
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        # Compile the regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex pattern: {str(e)}"}), 400
        
        # Build ps command
        ps_command = ['ps']
        
        # Parse filter_flags and add them as arguments
        if filter_flags:
            flags = filter_flags.strip().split()
            ps_command.extend(flags)
        
        # Execute ps command
        try:
            result = subprocess.run(ps_command, capture_output=True, text=True, timeout=5)
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Command execution timeout"}), 500
        except Exception as e:
            return jsonify({"code": 500, "message": f"Failed to execute ps command: {str(e)}"}), 500
        
        if result.returncode != 0:
            return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        
        if len(lines) == 0:
            return jsonify([]), 200
        
        # Skip header line
        processes = []
        for line in lines[1:]:
            # Match the regex against the entire line
            if pattern.search(line):
                # Extract PID (first column after whitespace split)
                parts = line.split(None, 10)
                if len(parts) >= 2:
                    try:
                        # PID is typically the second column in 'aux' format
                        # For 'aux' format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
                        pid = int(parts[1])
                        processes.append({
                            "processId": pid,
                            "processString": line
                        })
                    except (ValueError, IndexError):
                        # Skip lines that don't have a valid PID
                        continue
        
        return jsonify(processes), 200
        
    except Exception as e:
        return jsonify({"code": 500, "message": f"Internal server error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)