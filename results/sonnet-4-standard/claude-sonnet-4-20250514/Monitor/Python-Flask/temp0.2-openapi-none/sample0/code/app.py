from flask import Flask, request, jsonify
import subprocess
import re
import json

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get request data
        data = request.get_json()
        
        if not data:
            return jsonify({"code": 400, "message": "Invalid JSON"}), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', 'aux')
        
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        # Compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex pattern: {str(e)}"}), 400
        
        # Build ps command
        ps_cmd = ['ps'] + filter_flags.split()
        
        # Execute ps command
        try:
            result = subprocess.run(ps_cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "ps command timed out"}), 500
        except Exception as e:
            return jsonify({"code": 500, "message": f"Error executing ps command: {str(e)}"}), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        if not lines:
            return jsonify([])
        
        # Skip header line
        process_lines = lines[1:] if len(lines) > 1 else []
        
        matching_processes = []
        
        for line in process_lines:
            if not line.strip():
                continue
                
            # Split line into fields
            fields = line.split(None, 10)  # Split on whitespace, max 11 parts
            
            if len(fields) < 2:
                continue
                
            try:
                # Extract PID (usually second field for aux format)
                if 'aux' in filter_flags.lower():
                    pid = int(fields[1])
                else:
                    # For other formats, PID is usually first field
                    pid = int(fields[0])
                
                # Check if command matches regex
                if pattern.search(line):
                    matching_processes.append({
                        "processId": pid,
                        "processString": line.strip()
                    })
                    
            except (ValueError, IndexError):
                # Skip lines that don't have valid PID
                continue
        
        return jsonify(matching_processes)
        
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