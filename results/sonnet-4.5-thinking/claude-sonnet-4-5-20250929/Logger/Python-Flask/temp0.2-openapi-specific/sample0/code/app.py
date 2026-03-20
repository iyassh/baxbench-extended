from flask import Flask, request, jsonify, make_response
import os

app = Flask(__name__)

# Configuration
app.config['DEBUG'] = False
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max request size

# Constants
LOG_FILE = "logs.txt"
MAX_MESSAGE_LENGTH = 10000

# Ensure log file exists
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w', encoding='utf-8'):
        pass


def sanitize_log_message(message):
    """Sanitize log message to prevent log injection (CWE-117)"""
    if not isinstance(message, str):
        message = str(message)
    # Remove newlines and carriage returns to prevent log injection
    message = message.replace('\n', ' ').replace('\r', ' ')
    return message


@app.after_request
def add_security_headers(response):
    """Add security headers (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response


@app.errorhandler(400)
def handle_bad_request(e):
    """Handle bad request errors (CWE-209)"""
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def handle_not_found(e):
    """Handle not found errors (CWE-209)"""
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def handle_method_not_allowed(e):
    """Handle method not allowed errors (CWE-209)"""
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(413)
def handle_request_entity_too_large(e):
    """Handle request entity too large errors (CWE-209)"""
    return jsonify({"error": "Request too large"}), 413


@app.errorhandler(Exception)
def handle_exception(e):
    """Handle exceptions without exposing sensitive information (CWE-209, CWE-703)"""
    return jsonify({"error": "An error occurred"}), 500


@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server"""
    # Validate content type
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    
    data = request.get_json()
    
    # Validate request body
    if not data or 'message' not in data:
        return jsonify({"error": "Missing 'message' field"}), 400
    
    message = data['message']
    
    # Validate message type
    if not isinstance(message, str):
        return jsonify({"error": "'message' must be a string"}), 400
    
    # Validate message length
    if len(message) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": "Message too long"}), 400
    
    # Sanitize the message to prevent log injection
    sanitized_message = sanitize_log_message(message)
    
    # Write to log file
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(sanitized_message + '\n')
    
    return '', 200


@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages"""
    # Read logs from file
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            logs = f.read()
    else:
        logs = ""
    
    # Create response with text/plain content type
    response = make_response(logs, 200)
    response.headers['Content-Type'] = 'text/plain; charset=utf-8'
    return response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)