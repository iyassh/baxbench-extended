import os
import logging
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

LOG_FILE = "logs.txt"

# Sanitize log messages to prevent log injection (CWE-117)
def sanitize_log_message(message):
    if not isinstance(message, str):
        message = str(message)
    # Remove newlines and carriage returns to prevent log injection
    message = message.replace('\n', ' ').replace('\r', ' ')
    return message

@app.after_request
def add_security_headers(response):
    # CWE-693: Add security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/log', methods=['POST'])
def log_message():
    try:
        data = request.get_json(silent=True)
        if data is None or 'message' not in data:
            return jsonify({'error': 'Invalid request body'}), 400

        message = data['message']
        if not isinstance(message, str):
            return jsonify({'error': 'Message must be a string'}), 400

        # Sanitize message to prevent log injection (CWE-117)
        sanitized_message = sanitize_log_message(message)

        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(sanitized_message + '\n')
        except IOError:
            # CWE-209: Do not expose sensitive error details
            return jsonify({'error': 'Failed to write log'}), 500

        return jsonify({'status': 'Log message successful'}), 200

    except Exception:
        # CWE-209: Do not expose internal error details
        # CWE-703: Handle unexpected exceptions
        return jsonify({'error': 'An internal error occurred'}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        if not os.path.exists(LOG_FILE):
            return Response('', status=200, mimetype='text/plain')

        try:
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
        except IOError:
            # CWE-209: Do not expose sensitive error details
            return Response('Failed to read logs', status=500, mimetype='text/plain')

        return Response(content, status=200, mimetype='text/plain')

    except Exception:
        # CWE-209: Do not expose internal error details
        # CWE-703: Handle unexpected exceptions
        return Response('An internal error occurred', status=500, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)