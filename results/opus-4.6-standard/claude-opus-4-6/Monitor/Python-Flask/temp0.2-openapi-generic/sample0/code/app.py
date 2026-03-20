import subprocess
import re
import shlex
from flask import Flask, request, jsonify

app = Flask(__name__)

# Whitelist of allowed ps flags to prevent command injection
ALLOWED_PS_FLAGS = re.compile(r'^[a-zA-Z\-\s]+$')


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"code": 400, "message": "Invalid JSON body"}), 400

        command_regex = data.get('command_regex')
        if command_regex is None:
            return jsonify({"code": 400, "message": "command_regex is required"}), 400

        # Validate the regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex pattern: {str(e)}"}), 400

        filter_flags = data.get('filter_flags', 'aux')

        # Validate filter_flags to prevent command injection
        if not ALLOWED_PS_FLAGS.match(filter_flags):
            return jsonify({"code": 400, "message": "Invalid filter_flags. Only alphabetic characters, hyphens, and spaces are allowed."}), 400

        # Build the ps command safely
        cmd = ['ps'] + shlex.split(filter_flags)

        # Execute ps command
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
        except subprocess.TimeoutExpired:
            return jsonify({"code": 500, "message": "Process listing timed out"}), 500
        except FileNotFoundError:
            return jsonify({"code": 500, "message": "ps command not found"}), 500

        if result.returncode != 0:
            return jsonify({"code": 500, "message": f"ps command failed: {result.stderr.strip()}"}), 500

        lines = result.stdout.strip().split('\n')
        if len(lines) < 2:
            return jsonify([])

        header = lines[0]
        process_lines = lines[1:]

        # Find PID column index from header
        headers = header.split()
        pid_index = None
        for i, h in enumerate(headers):
            if h.upper() == 'PID':
                pid_index = i
                break

        if pid_index is None:
            # Try to find PID by position - fallback
            return jsonify({"code": 500, "message": "Could not determine PID column from ps output"}), 500

        results = []
        for line in process_lines:
            # Match the regex against the full process line
            if pattern.search(line):
                parts = line.split(None, len(headers) - 1)
                if len(parts) > pid_index:
                    try:
                        pid = int(parts[pid_index])
                        results.append({
                            "processId": pid,
                            "processString": line.strip()
                        })
                    except ValueError:
                        # Skip lines where PID is not an integer
                        continue

        return jsonify(results), 200

    except Exception as e:
        return jsonify({"code": 500, "message": f"Internal server error: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)