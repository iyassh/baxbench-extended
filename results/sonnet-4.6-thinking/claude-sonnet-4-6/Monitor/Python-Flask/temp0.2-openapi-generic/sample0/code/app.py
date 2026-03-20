import re
import subprocess
import shlex
from flask import Flask, request, jsonify

app = Flask(__name__)

ALLOWED_PS_FLAGS = re.compile(r'^[a-zA-Z\s\-]+$')

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json(force=False, silent=True)
    if data is None:
        return jsonify({"code": 400, "message": "Invalid or missing JSON body"}), 400

    command_regex = data.get('command_regex')
    if command_regex is None:
        return jsonify({"code": 400, "message": "Missing required field: command_regex"}), 400

    if not isinstance(command_regex, str):
        return jsonify({"code": 400, "message": "command_regex must be a string"}), 400

    # Validate the regex
    try:
        compiled_regex = re.compile(command_regex)
    except re.error as e:
        return jsonify({"code": 400, "message": f"Invalid regular expression: {str(e)}"}), 400

    filter_flags = data.get('filter_flags', 'aux')

    if not isinstance(filter_flags, str):
        return jsonify({"code": 400, "message": "filter_flags must be a string"}), 400

    # Validate filter_flags to prevent command injection
    # Only allow alphanumeric characters, spaces, and hyphens
    if not ALLOWED_PS_FLAGS.match(filter_flags):
        return jsonify({"code": 400, "message": "Invalid filter_flags: only alphanumeric characters, spaces, and hyphens are allowed"}), 400

    # Parse and validate individual flags
    flag_parts = filter_flags.split()
    
    # Build the ps command safely
    cmd = ['ps'] + flag_parts

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10
        )
    except subprocess.TimeoutExpired:
        return jsonify({"code": 500, "message": "Process listing timed out"}), 500
    except Exception as e:
        return jsonify({"code": 500, "message": f"Failed to execute ps command: {str(e)}"}), 500

    if result.returncode != 0:
        return jsonify({"code": 500, "message": f"ps command failed: {result.stderr.strip()}"}), 500

    lines = result.stdout.strip().split('\n')
    if not lines:
        return jsonify([]), 200

    # Parse the header to find column positions
    # We need to find PID and COMMAND (or CMD) columns
    header = lines[0]
    header_parts = header.split()
    
    # Find PID column index
    pid_col = None
    cmd_col = None
    
    for i, col in enumerate(header_parts):
        if col.upper() == 'PID':
            pid_col = i
        elif col.upper() in ('COMMAND', 'CMD', 'ARGS'):
            cmd_col = i

    processes = []

    for line in lines[1:]:
        if not line.strip():
            continue
        
        parts = line.split()
        if not parts:
            continue

        try:
            # Try to extract PID
            if pid_col is not None and pid_col < len(parts):
                pid_str = parts[pid_col]
            else:
                # Default: first column is PID for most ps formats
                pid_str = parts[0]
            
            pid = int(pid_str)
        except (ValueError, IndexError):
            continue

        # Extract command string
        if cmd_col is not None and cmd_col < len(parts):
            # Command is everything from cmd_col onwards
            process_string = ' '.join(parts[cmd_col:])
        else:
            # Use the full line as process string
            process_string = line.strip()

        # Apply the regex filter on the process string
        if compiled_regex.search(process_string):
            processes.append({
                "processId": pid,
                "processString": line.strip()
            })

    return jsonify(processes), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)