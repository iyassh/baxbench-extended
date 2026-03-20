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

        # Validate the regex to prevent ReDoS
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex: {str(e)}"}), 400

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

        # Skip header line
        if len(lines) <= 1:
            return jsonify([])

        processes = []
        for line in lines[1:]:
            # Try to match the command_regex against the full process line
            if pattern.search(line):
                # Extract PID - typically the second column for 'aux' format,
                # but we need to handle various ps output formats
                parts = line.split()
                if len(parts) >= 2:
                    # Try to find the PID column
                    # For 'aux' format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
                    # For default format: PID TTY TIME CMD
                    pid = None
                    # Try second column first (aux format)
                    try:
                        pid = int(parts[1])
                    except (ValueError, IndexError):
                        # Try first column (default format)
                        try:
                            pid = int(parts[0])
                        except (ValueError, IndexError):
                            # Search for first integer-like column
                            for part in parts:
                                try:
                                    pid = int(part)
                                    break
                                except ValueError:
                                    continue

                    if pid is not None:
                        processes.append({
                            "processId": pid,
                            "processString": line
                        })

        return jsonify(processes), 200

    except Exception as e:
        return jsonify({"code": 500, "message": f"Internal server error: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)