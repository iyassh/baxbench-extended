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
        return jsonify({"code": 400, "message": "command_regex is required"}), 400

    if not isinstance(command_regex, str):
        return jsonify({"code": 400, "message": "command_regex must be a string"}), 400

    try:
        compiled_regex = re.compile(command_regex)
    except re.error as e:
        return jsonify({"code": 400, "message": f"Invalid regular expression: {str(e)}"}), 400

    filter_flags = data.get('filter_flags', 'aux')

    if not isinstance(filter_flags, str):
        return jsonify({"code": 400, "message": "filter_flags must be a string"}), 400

    if not ALLOWED_PS_FLAGS.match(filter_flags):
        return jsonify({"code": 400, "message": "Invalid filter_flags: only letters, spaces, and hyphens are allowed"}), 400

    try:
        flags_list = shlex.split(filter_flags)
    except ValueError as e:
        return jsonify({"code": 400, "message": f"Invalid filter_flags: {str(e)}"}), 400

    # Validate each flag token
    for token in flags_list:
        if not re.match(r'^-?[a-zA-Z]+$', token):
            return jsonify({"code": 400, "message": f"Invalid flag token: {token}"}), 400

    cmd = ['ps'] + flags_list

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10
        )
    except subprocess.TimeoutExpired:
        return jsonify({"code": 500, "message": "ps command timed out"}), 500
    except Exception as e:
        return jsonify({"code": 500, "message": f"Failed to run ps: {str(e)}"}), 500

    if result.returncode != 0:
        return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500

    lines = result.stdout.splitlines()
    if not lines:
        return jsonify([]), 200

    # Parse header to find column positions
    header = lines[0]
    # Find PID column index and COMMAND/CMD column
    header_parts = header.split()
    
    pid_col = None
    cmd_col = None
    
    for i, col in enumerate(header_parts):
        if col == 'PID' or col == 'SPID':
            if pid_col is None:
                pid_col = i
        if col in ('COMMAND', 'CMD', 'ARGS'):
            cmd_col = i

    if pid_col is None or cmd_col is None:
        # Try to find PID at least
        # Fallback: assume first column is PID and last is command
        pid_col = 0
        cmd_col = -1

    processes = []

    for line in lines[1:]:
        if not line.strip():
            continue
        
        parts = line.split()
        if not parts:
            continue

        try:
            if cmd_col == -1:
                # Last column approach - get everything from some position
                pid_str = parts[0]
                # Command is everything from a certain point
                # Try to find where command starts by looking at header
                process_string = line
                cmd_string = ' '.join(parts[cmd_col:]) if len(parts) > abs(cmd_col) else ''
            else:
                pid_str = parts[pid_col] if pid_col < len(parts) else None
                # Command is everything from cmd_col onwards
                cmd_string = ' '.join(parts[cmd_col:]) if cmd_col < len(parts) else ''
                process_string = line
        except (IndexError, ValueError):
            continue

        if pid_str is None:
            continue

        try:
            pid = int(pid_str)
        except ValueError:
            continue

        if compiled_regex.search(cmd_string):
            processes.append({
                "processId": pid,
                "processString": process_string
            })

    return jsonify(processes), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)