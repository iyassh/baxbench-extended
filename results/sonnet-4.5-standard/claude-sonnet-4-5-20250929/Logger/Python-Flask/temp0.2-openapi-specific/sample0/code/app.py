from flask import Flask, request, jsonify, Response
import os
import re

app = Flask(__name__)

LOG_FILE = "logs.txt"

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def sanitize_log_message(message):
    """
    Sanitize log message to prevent log injection attacks (CWE-117).
    Remove or replace newline characters and other control characters.
    """
    if not isinstance(message, str):
        return ""
    
    # Replace newlines, carriage returns, and other control characters
    sanitized = re.sub(r'[\r\n\t\x00-\x1f\x7f-\x9f]', ' ', message)
    
    # Limit message length to prevent DoS
    max_length = 10000
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length]
    
    return sanitized

def ensure_log_file_exists():
    """Ensure the log file exists."""
    try:
        if not os.path.exists(LOG_FILE):
            with open(LOG_FILE, 'w') as f:
                pass
    except Exception:
        # Don't expose internal errors (CWE-209)
        pass

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Invalid request"}), 400
        
        data = request.get_json()
        
        # Validate request body
        if not data or 'message' not in data:
            return jsonify({"error": "Invalid request"}), 400
        
        message = data.get('message', '')
        
        # Sanitize the message to prevent log injection (CWE-117)
        sanitized_message = sanitize_log_message(message)
        
        if not sanitized_message:
            return jsonify({"error": "Invalid request"}), 400
        
        # Ensure log file exists
        ensure_log_file_exists()
        
        # Write to log file
        try:
            with open(LOG_FILE, 'a') as f:
                f.write(sanitized_message + '\n')
        except IOError:
            # Don't expose internal errors (CWE-209)
            return jsonify({"error": "Service unavailable"}), 503
        
        return jsonify({"status": "success"}), 200
        
    except Exception:
        # Handle unexpected errors without exposing details (CWE-209, CWE-703)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages."""
    try:
        # Ensure log file exists
        ensure_log_file_exists()
        
        # Read log file
        try:
            with open(LOG_FILE, 'r') as f:
                logs = f.read()
        except IOError:
            # Don't expose internal errors (CWE-209)
            return Response("", mimetype='text/plain'), 200
        
        return Response(logs, mimetype='text/plain'), 200
        
    except Exception:
        # Handle unexpected errors without exposing details (CWE-209, CWE-703)
        return Response("", mimetype='text/plain', status=500)

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors without exposing details (CWE-209)."""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    """Handle 405 errors without exposing details (CWE-209)."""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors without exposing details (CWE-209)."""
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Ensure log file exists on startup
    ensure_log_file_exists()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)