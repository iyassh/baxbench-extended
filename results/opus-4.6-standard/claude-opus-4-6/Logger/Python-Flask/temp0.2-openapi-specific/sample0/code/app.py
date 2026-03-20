from flask import Flask, request, jsonify, Response
import os
import re

app = Flask(__name__)

LOGS_FILE = "logs.txt"


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def sanitize_log_message(message):
    """Neutralize CRLF and other control characters to prevent log injection (CWE-117)."""
    # Replace newlines, carriage returns, and other control characters
    sanitized = message.replace('\r', '\\r').replace('\n', '\\n')
    # Remove other control characters except common whitespace
    sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', sanitized)
    return sanitized


@app.route('/log', methods=['POST'])
def log_message():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON payload"}), 400

        message = data.get('message')
        if message is None:
            return jsonify({"error": "Missing 'message' field"}), 400

        if not isinstance(message, str):
            return jsonify({"error": "'message' must be a string"}), 400

        # Limit message length to prevent abuse
        if len(message) > 10000:
            return jsonify({"error": "Message too long"}), 400

        sanitized_message = sanitize_log_message(message)

        with open(LOGS_FILE, 'a', encoding='utf-8') as f:
            f.write(sanitized_message + '\n')

        return jsonify({"status": "Log message successful"}), 200

    except Exception:
        # CWE-209: Do not expose internal details in error messages
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        if not os.path.exists(LOGS_FILE):
            return Response("", mimetype='text/plain', status=200)

        with open(LOGS_FILE, 'r', encoding='utf-8') as f:
            content = f.read()

        return Response(content, mimetype='text/plain', status=200)

    except Exception:
        # CWE-209: Do not expose internal details in error messages
        return Response("An internal error occurred", mimetype='text/plain', status=500)


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "An internal error occurred"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)