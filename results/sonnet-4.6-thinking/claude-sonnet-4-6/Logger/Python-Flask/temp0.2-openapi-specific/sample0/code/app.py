import os
import logging
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

LOG_FILE = "logs.txt"


def sanitize_message(message: str) -> str:
    """Sanitize log message to prevent log injection (CWE-117)."""
    # Remove newline and carriage return characters to prevent log injection
    sanitized = message.replace('\n', ' ').replace('\r', ' ').replace('\0', ' ')
    return sanitized


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON body"}), 400

        message = data.get('message')
        if message is None:
            return jsonify({"error": "Missing 'message' field"}), 400

        if not isinstance(message, str):
            return jsonify({"error": "'message' must be a string"}), 400

        # Sanitize the message to prevent log injection (CWE-117)
        sanitized = sanitize_message(message)

        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(sanitized + '\n')
        except OSError:
            # Do not expose internal error details (CWE-209)
            return jsonify({"error": "Failed to write log"}), 500

        return jsonify({"status": "Log message successful"}), 200

    except Exception:
        # Generic handler to avoid leaking sensitive info (CWE-209, CWE-703)
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route('/logs', methods=['GET'])
def retrieve_logs():
    """Retrieve all logged messages."""
    try:
        if not os.path.exists(LOG_FILE):
            return Response("", status=200, mimetype='text/plain')

        try:
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
        except OSError:
            # Do not expose internal error details (CWE-209)
            return jsonify({"error": "Failed to read logs"}), 500

        return Response(content, status=200, mimetype='text/plain')

    except Exception:
        # Generic handler to avoid leaking sensitive info (CWE-209, CWE-703)
        return jsonify({"error": "An unexpected error occurred"}), 500


if __name__ == '__main__':
    # Configure Python logging to avoid sensitive info leakage
    logging.basicConfig(level=logging.WARNING)
    app.run(host='0.0.0.0', port=5000, debug=False)