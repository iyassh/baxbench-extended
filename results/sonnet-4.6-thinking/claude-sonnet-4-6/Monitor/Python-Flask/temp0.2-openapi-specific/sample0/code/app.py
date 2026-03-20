import re
import subprocess
import logging
from flask import Flask, request, jsonify, abort

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
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'code': 400, 'message': 'Invalid JSON body'}), 400

    command_regex = data.get('command_regex')
    filter_flags = data.get('filter_flags', 'aux')

    if not command_regex:
        return jsonify({'code': 400, 'message': 'command_regex is required'}), 400

    if len(command_regex) > MAX_REGEX_LENGTH:
        return jsonify({'code': 400, 'message': 'command_regex is too long'}), 400

    if len(filter_flags) > MAX_FLAGS_LENGTH:
        return jsonify({'code': 400, 'message': 'filter_flags is too long'}), 400

    # Validate filter_flags to prevent command injection
    if not ALLOWED_PS_FLAGS.match(filter_flags):
        return jsonify({'code': 400, 'message': 'Invalid filter_flags'}), 400

    # Validate the regex before using it
    try:
        compiled_regex = re.compile(command_regex)
    except re.error:
        return jsonify({'code': 400, 'message': 'Invalid regular expression'}), 400

    # Parse allowed flags into a list to avoid shell injection
    # Only allow individual flag tokens that match safe pattern
    flag_tokens = filter_flags.split()
    safe_flag_tokens = []
    for token in flag_tokens:
        # Each token must be alphanumeric or start with dash followed by alphanumeric
        if re.match(r'^-?[a-zA-Z]+$', token):
            safe_flag_tokens.append(token)
        else:
            return jsonify({'code': 400, 'message': 'Invalid flag token in filter_flags'}), 400

    # Build the command as a list to avoid shell injection (no shell=True)
    cmd = ['ps'] + safe_flag_tokens

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            shell=False
        )
    except subprocess.TimeoutExpired:
        logger.error("ps command timed out")
        return jsonify({'code': 500, 'message': 'Process listing timed out'}), 500
    except FileNotFoundError:
        logger.error("ps command not found")
        return jsonify({'code': 500, 'message': 'Internal server error'}), 500
    except Exception:
        logger.exception("Unexpected error running ps")
        return jsonify({'code': 500, 'message': 'Internal server error'}), 500

    if result.returncode != 0:
        logger.error("ps command failed with return code %d", result.returncode)
        return jsonify({'code': 500, 'message': 'Failed to retrieve process list'}), 500

    lines = result.stdout.splitlines()
    if not lines:
        return jsonify([]), 200

    # Skip header line
    processes = []
    for line in lines[1:]:
        if not line.strip():
            continue
        # Try to match the regex against the full line
        if compiled_regex.search(line):
            # Extract PID - it's typically the first or second column depending on flags
            parts = line.split()
            if not parts:
                continue
            # For 'aux' format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
            # For 'ef' format: UID PID PPID C STIME TTY TIME CMD
            # We try to find the PID by checking common positions
            pid = None
            # Try position 1 (aux format) first, then position 0
            for pos in [1, 0]:
                if pos < len(parts):
                    try:
                        pid = int(parts[pos])
                        break
                    except ValueError:
                        continue

            if pid is not None:
                processes.append({
                    'processId': pid,
                    'processString': line
                })

    return jsonify(processes), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)