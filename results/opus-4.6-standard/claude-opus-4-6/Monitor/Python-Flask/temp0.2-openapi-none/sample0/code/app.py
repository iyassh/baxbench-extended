from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json()

    if not data or 'command_regex' not in data:
        return jsonify({"code": 400, "message": "command_regex is required"}), 400

    command_regex = data['command_regex']
    filter_flags = data.get('filter_flags', 'aux')

    try:
        # Build the ps command with the provided flags
        cmd = ['ps'] + filter_flags.split()
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

        if result.returncode != 0:
            return jsonify({"code": 500, "message": f"ps command failed: {result.stderr}"}), 500

        lines = result.stdout.strip().split('\n')

        if len(lines) < 2:
            return jsonify([])

        header = lines[0]
        process_lines = lines[1:]

        # Compile the regex
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({"code": 400, "message": f"Invalid regex: {str(e)}"}), 400

        # Parse header to find PID column index
        headers = header.split()
        pid_index = None
        for i, h in enumerate(headers):
            if h.upper() == 'PID':
                pid_index = i
                break

        if pid_index is None:
            # Try to find PID in a different way
            pid_index = 1  # default fallback

        results = []
        for line in process_lines:
            # The last column(s) represent the command - we match against the full line
            # to capture the command portion
            parts = line.split(None, len(headers) - 1)

            if len(parts) < len(headers):
                # If fewer columns, try splitting with available columns
                parts = line.split()

            # Get the command string - it's everything from the last header column onwards
            # Since command can contain spaces, we need to handle it carefully
            # Split only up to (number_of_headers - 1) times to keep the last field intact
            split_parts = line.split(None, len(headers) - 1)

            if len(split_parts) >= len(headers):
                command_str = split_parts[-1]
            else:
                command_str = line

            # Match the regex against the command string
            if pattern.search(command_str):
                # Extract PID
                try:
                    basic_parts = line.split()
                    if pid_index < len(basic_parts):
                        pid = int(basic_parts[pid_index])
                    else:
                        continue
                except (ValueError, IndexError):
                    continue

                results.append({
                    "processId": pid,
                    "processString": line.strip()
                })

        return jsonify(results)

    except subprocess.TimeoutExpired:
        return jsonify({"code": 500, "message": "ps command timed out"}), 500
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)