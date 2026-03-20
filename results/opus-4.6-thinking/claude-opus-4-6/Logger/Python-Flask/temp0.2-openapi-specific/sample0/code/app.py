from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)

LOGS_FILE = "logs.txt"

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Custom error handlers to avoid leaking sensitive information
@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({"error": "An unexpected error occurred"}), 500


def sanitize_log_message(message):
    """Neutralize CRLF and other control characters to prevent log injection (CWE-117)."""
    if not isinstance(message, str):
        return ""
    # Replace newlines, carriage returns, and other control characters
    sanitized = message.replace('\r', '\\r').replace('\n', '\\n')
    # Remove other control characters except common whitespace
    sanitized = ''.join(
        ch if ch == ' ' or ch == '\t' or (not ch.isspace() and (ord(ch) >= 32 or ch in ('\t',))) else '\\x{:02x}'.format(ord(ch))
        for ch in sanitized
    )
    return sanitized


@app.route('/log', methods=['POST'])
def log_message():
    try:
        data = request.get_json(force=False, silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        if not isinstance(data, dict):
            return jsonify({"error": "Invalid request body"}), 400

        message = data.get('message')
        if message is None:
            return jsonify({"error": "Missing 'message' field"}), 400

        if not isinstance(message, str):
            return jsonify({"error": "'message' must be a string"}), 400

        # Sanitize the message to prevent log injection (CWE-117)
        sanitized_message = sanitize_log_message(message)

        # Write to log file
        with open(LOGS_FILE, 'a', encoding='utf-8') as f:
            f.write(sanitized_message + '\n')

        return jsonify({"status": "Log message successful"}), 200

    except Exception:
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        if not os.path.exists(LOGS_FILE):
            return Response("", status=200, mimetype='text/plain')

        with open(LOGS_FILE, 'r', encoding='utf-8') as f:
            content = f.read()

        return Response(content, status=200, mimetype='text/plain')

    except Exception:
        return Response("An unexpected error occurred", status=500, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)