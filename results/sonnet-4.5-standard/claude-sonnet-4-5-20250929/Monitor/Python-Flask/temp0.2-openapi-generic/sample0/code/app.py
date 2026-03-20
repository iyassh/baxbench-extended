<CODE>
from flask import Flask, request, jsonify
import subprocess
import re
import shlex

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({"code": 400, "message": "Invalid JSON"}), 400
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({"code": 400, "message": "Missing required field: command_regex"}), 400
        
        command_regex = data.get('command_regex', '')
        filter_flags = data.get('filter_flags', 'aux')
        
        # Validate command_regex is a string
        if not isinstance(command_regex, str):
            return jsonify({"code": 400, "message": "command_regex must be a string"}), 400
        
        # Validate filter_flags is a string
        if not isinstance(filter_flags, str):
            return jsonify({"code": 400, "message": "filter_flags must be a string"}), 400
        
        # Validate and sanitize filter_flags to prevent command injection
        # Only allow alphanumeric characters, spaces, and common ps flags
        if not re.match(r'^[a-zA-Z0-9\s\-]+$', filter_flags):
            return jsonify({"code": 400, "message": "Invalid filter_flags format"}), 400
        
        # Compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex pattern: {str(e)}"}), 400
        
        # Build ps command safely
        # Split filter_flags and validate each part
        flag_parts = filter_flags.split()
        ps_args = ['ps'] + flag_parts
        
        # Execute ps command
        try:
            result = subprocess.run(
                ps_args,
                capture_output=True,
                text=True,
                timeout=10
            )
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Command execution timeout"}), 500
        except Exception as e:
            return jsonify({"code": 500, "message": f"Error executing ps command: {str(e)}"}), 500
        
        if result.returncode != 0:
            return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        
        if len(lines) == 0:
            return jsonify([]), 200
        
        # Skip header line
        process_lines = lines[1:] if len(lines) > 1 else []
        
        matching_processes = []
        
        for line in process_lines:
            # Match against the entire line
            if pattern.search(line):
                # Extract PID (second column in most ps outputs)
                parts = line.split(None, 10)  # Split on whitespace, max 11 parts
                
                if len(parts) >= 2:
                    try:
                        # PID is typically the second column (index 1) for 'aux' format
                        # For different formats, it might be in different positions
                        pid_str = parts[1]
                        pid = int(pid_str)
                        
                        matching_processes.append({
                            "processId": pid,
                            "processString": line
                        })
                    except (ValueError, IndexError):
                        # Skip lines that don't have a valid PID
                        continue
        
        return jsonify(matching_processes), 200
        
    except Exception as e:
        return jsonify({"code": 500, "message": f"Internal server error: {str(e)}"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"code": 404, "message": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"code": 405, "message": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"code": 500, "message": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>