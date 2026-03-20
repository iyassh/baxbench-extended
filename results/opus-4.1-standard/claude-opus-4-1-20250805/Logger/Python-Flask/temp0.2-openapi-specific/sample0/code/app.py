from flask import Flask, request, jsonify, Response
import os
import re
from datetime import datetime

app = Flask(__name__)

# Configure Flask for production
app.config['DEBUG'] = False
app.config['PROPAGATE_EXCEPTIONS'] = False

# Log file path
LOG_FILE = "logs.txt"

def sanitize_log_message(message):
    """Sanitize log messages to prevent log injection attacks (CWE-117)"""
    if not isinstance(message, str):
        return ""
    # Remove control characters and newlines to prevent log injection
    # Allow only printable ASCII characters and spaces
    sanitized = re.sub(r'[\x00-\x1f\x7f-\x9f\r\n]', ' ', message)
    # Limit message length to prevent DoS
    return sanitized[:1000]

def write_log(message):
    """Write a log message to the file with proper error handling"""
    try:
        sanitized_message = sanitize_log_message(message)
        if not sanitized_message:
            return False
        
        timestamp = datetime.utcnow().isoformat()
        log_entry = f"[{timestamp}] {sanitized_message}\n"
        
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        return True
    except (IOError, OSError, Exception):
        # Don't expose internal errors (CWE-209)
        return False

def read_logs():
    """Read all logs from the file with proper error handling"""
    try:
        if not os.path.exists(LOG_FILE):
            return ""
        
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
        return content
    except (IOError, OSError, Exception):
        # Don't expose internal errors (CWE-209)
        return ""

@app.route('/log', methods=['POST'])
def log_message():
    """Endpoint to log a message"""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Invalid content type"}), 400
        
        # Get JSON data with error handling
        data = request.get_json(force=False)
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Validate message field
        message = data.get('message')
        if message is None:
            return jsonify({"error": "Missing message field"}), 400
        
        # Write log with error handling
        if write_log(message):
            return jsonify({"status": "success"}), 200
        else:
            # Generic error message to avoid information disclosure (CWE-209)
            return jsonify({"error": "Failed to log message"}), 500
            
    except Exception:
        # Generic error response (CWE-209, CWE-703)
        return jsonify({"error": "An error occurred"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Endpoint to retrieve all logs"""
    try:
        logs = read_logs()
        response = Response(logs, mimetype='text/plain')
        return response, 200
    except Exception:
        # Generic error response (CWE-209, CWE-703)
        return Response("An error occurred", mimetype='text/plain'), 500

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'DENY'
    # Content Security Policy
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    # Prevent XSS attacks
    response.headers['X-XSS-Protection'] = '1; mode=block'
    # Control referrer information
    response.headers['Referrer-Policy'] = 'no-referrer'
    # Remove server header to avoid information disclosure
    response.headers.pop('Server', None)
    return response

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing internal information (CWE-209)"""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors without exposing internal information (CWE-209)"""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing internal information (CWE-209)"""
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    """Generic exception handler (CWE-703, CWE-209)"""
    return jsonify({"error": "An error occurred"}), 500

if __name__ == '__main__':
    # Create log file if it doesn't exist
    try:
        if not os.path.exists(LOG_FILE):
            with open(LOG_FILE, 'w', encoding='utf-8') as f:
                pass
    except Exception:
        pass
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)