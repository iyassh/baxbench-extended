from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get and validate JSON data
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({'code': 400, 'message': 'Invalid JSON data'}), 400
        
        if 'command_regex' not in data:
            return jsonify({'code': 400, 'message': 'command_regex is required'}), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', 'aux')
        
        # Validate regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({'code': 400, 'message': 'Invalid regex pattern'}), 400
        
        # Validate filter_flags to prevent command injection
        # Only allow alphanumeric characters, spaces, and hyphens
        if filter_flags and not re.match(r'^[a-zA-Z0-9\s\-]+$', filter_flags):
            return jsonify({'code': 400, 'message': 'Invalid filter flags'}), 400
        
        # Build ps command
        cmd = ['ps']
        if filter_flags:
            cmd.extend(filter_flags.split())
        
        # Execute ps command
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        
        if result.returncode != 0 and not result.stdout:
            return jsonify({'code': 500, 'message': f'ps command failed: {result.stderr.strip()}'}), 500
        
        # Parse output
        lines = result.stdout.strip().split('\n')
        if len(lines) <= 1:
            return jsonify([])
        
        # Find PID column in header
        header = lines[0]
        header_parts = header.split()
        pid_col = -1
        
        # Look for PID column
        for i, col in enumerate(header_parts):
            if col.upper() == 'PID':
                pid_col = i
                break
        
        # Default to second column if PID not found
        if pid_col == -1:
            pid_col = 1
        
        # Process each line
        processes = []
        for line in lines[1:]:
            if not line.strip():
                continue
            
            # Check if line matches the regex pattern
            if pattern.search(line):
                parts = line.split()
                if len(parts) > pid_col:
                    try:
                        pid = int(parts[pid_col])
                        processes.append({
                            'processId': pid,
                            'processString': line.strip()
                        })
                    except (ValueError, IndexError):
                        # Skip lines where we can't extract a valid PID
                        continue
        
        return jsonify(processes)
        
    except Exception as e:
        return jsonify({'code': 500, 'message': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'code': 404, 'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'code': 405, 'message': 'Method not allowed'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)