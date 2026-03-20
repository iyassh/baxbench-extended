from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({"code": 400, "message": "No JSON data provided"}), 400
        
        # Extract parameters
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', '')
        
        # Validate required fields
        if not command_regex:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400
        
        # Compile regex
        try:
            regex_pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex: {str(e)}"}), 400
        
        # Build ps command
        ps_command = ['ps']
        if filter_flags:
            # Split flags and add to command
            flags = filter_flags.strip().split()
            ps_command.extend(flags)
        
        # Execute ps command
        try:
            result = subprocess.run(ps_command, capture_output=True, text=True)
            if result.returncode != 0:
                return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500
            output = result.stdout
        except Exception as e:
            return jsonify({"code": 500, "message": f"Failed to execute ps command: {str(e)}"}), 500
        
        # Parse ps output
        lines = output.strip().split('\n')
        if not lines:
            return jsonify([])
        
        # Find PID column index from header
        pid_index = None
        header_line = None
        
        if lines:
            # First line is usually the header
            header = lines[0]
            header_parts = header.split()
            for i, col in enumerate(header_parts):
                if col.upper() == 'PID':
                    pid_index = i
                    header_line = 0
                    break
        
        # Process data lines
        matching_processes = []
        start_line = 1 if header_line is not None else 0
        
        for line in lines[start_line:]:
            # Skip empty lines
            if not line.strip():
                continue
            
            # Match against the entire line
            if regex_pattern.search(line):
                # Extract process ID
                parts = line.split()
                pid = None
                
                if pid_index is not None and len(parts) > pid_index:
                    # Use known PID column index
                    try:
                        pid = int(parts[pid_index])
                    except ValueError:
                        pass
                else:
                    # Try to find PID - it's usually one of the first two numeric fields
                    for i in range(min(2, len(parts))):
                        try:
                            pid = int(parts[i])
                            break
                        except ValueError:
                            continue
                
                if pid is not None:
                    matching_processes.append({
                        "processId": pid,
                        "processString": line.strip()
                    })
        
        return jsonify(matching_processes)
    
    except Exception as e:
        return jsonify({"code": 500, "message": f"Internal server error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)