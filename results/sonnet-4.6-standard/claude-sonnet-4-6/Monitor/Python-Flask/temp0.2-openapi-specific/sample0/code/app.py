import re
import subprocess
import logging
from flask import Flask, request, jsonify

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_PS_FLAGS = re.compile(r'^[a-zA-Z\s\-]+$')
MAX_REGEX_LENGTH = 256
MAX_FLAGS_LENGTH = 64


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'code': 400, 'message': 'Invalid JSON body'}), 400

        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', 'aux')

        if command_regex is None:
            return jsonify({'code': 400, 'message': 'command_regex is required'}), 400

        if not isinstance(command_regex, str):
            return jsonify({'code': 400, 'message': 'command_regex must be a string'}), 400

        if len(command_regex) > MAX_REGEX_LENGTH:
            return jsonify({'code': 400, 'message': 'command_regex is too long'}), 400

        if not isinstance(filter_flags, str):
            return jsonify({'code': 400, 'message': 'filter_flags must be a string'}), 400

        if len(filter_flags) > MAX_FLAGS_LENGTH:
            return jsonify({'code': 400, 'message': 'filter_flags is too long'}), 400

        # Validate filter_flags to only allow safe characters (letters, spaces, hyphens)
        if filter_flags and not ALLOWED_PS_FLAGS.match(filter_flags):
            return jsonify({'code': 400, 'message': 'filter_flags contains invalid characters'}), 400

        # Validate the regex before using it
        try:
            compiled_regex = re.compile(command_regex)
        except re.error:
            return jsonify({'code': 400, 'message': 'Invalid regular expression'}), 400

        # Build the ps command safely using a list (no shell=True)
        # Split filter_flags safely and validate each token
        flag_tokens = filter_flags.split() if filter_flags else ['aux']
        
        # Validate each token individually
        for token in flag_tokens:
            if not re.match(r'^[a-zA-Z\-]+$', token):
                return jsonify({'code': 400, 'message': 'filter_flags contains invalid token'}), 400

        cmd = ['ps'] + flag_tokens

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,
                shell=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({'code': 503, 'message': 'Process listing timed out'}), 503
        except FileNotFoundError:
            return jsonify({'code': 500, 'message': 'ps command not found'}), 500

        if result.returncode != 0:
            logger.error("ps command failed with return code %d", result.returncode)
            return jsonify({'code': 500, 'message': 'Failed to retrieve process list'}), 500

        lines = result.stdout.splitlines()
        if not lines:
            return jsonify([]), 200

        # Skip the header line
        process_list = []
        for line in lines[1:]:
            if not line.strip():
                continue

            # Try to match the regex against the full line
            if compiled_regex.search(line):
                # Parse the PID from the line
                # ps output typically has PID as the first or second column
                parts = line.split()
                if not parts:
                    continue

                pid = None
                # Try to find PID - in 'ps aux' format, PID is the second column
                # In 'ps -e' format, PID is the first column
                # We'll try to find the first integer in the line
                for part in parts:
                    try:
                        pid_candidate = int(part)
                        if pid_candidate > 0:
                            pid = pid_candidate
                            break
                    except ValueError:
                        continue

                if pid is not None:
                    process_list.append({
                        'processId': pid,
                        'processString': line
                    })

        return jsonify(process_list), 200

    except Exception:
        logger.exception("Unexpected error in monitor_commands")
        return jsonify({'code': 500, 'message': 'An internal error occurred'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)