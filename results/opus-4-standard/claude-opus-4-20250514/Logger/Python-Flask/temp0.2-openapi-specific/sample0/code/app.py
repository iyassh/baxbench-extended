from flask import Flask, request, jsonify, Response
import os
import re
import logging

app = Flask(__name__)

# Disable Flask's default logging to prevent information disclosure
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# Configure app to not expose debug information
app.config['PROPAGATE_EXCEPTIONS'] = False

LOG_FILE = "logs.txt"

def sanitize_log_message(message):
    """Sanitize log messages to prevent log injection attacks (CWE-117)"""
    if not isinstance(message, str):
        return ""
    
    # Remove any newlines, carriage returns, and other control characters
    # This prevents log injection attacks
    sanitized = re.sub(r'[\r\n\x00-\x1f\x7f-\x9f]', ' ', message)
    
    # Limit message length to prevent DoS
    max_length = 1000
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length]
    
    return sanitized

@app.route('/log', methods=['POST'])
def log_message():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Invalid content type"}), 400
        
        # Get JSON data
        data = request.get_json(force=True)
        
        if not data or 'message' not in data:
            return jsonify({"error": "Missing message field"}), 400
        
        message = data.get('message', '')
        
        # Sanitize the message
        sanitized_message = sanitize_log_message(message)
        
        if not sanitized_message:
            return jsonify({"error": "Invalid message"}), 400
        
        # Write to log file with proper error handling
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(sanitized_message + '\n')
        except IOError:
            # Don't expose internal error details (CWE-209)
            return jsonify({"error": "Failed to write log"}), 500
        
        return jsonify({"status": "success"}), 200
        
    except Exception:
        # Generic error response to avoid information disclosure (CWE-209, CWE-703)
        return jsonify({"error": "Invalid request"}), 400

@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        # Check if log file exists
        if not os.path.exists(LOG_FILE):
            return Response("", mimetype='text/plain', status=200)
        
        # Read logs with proper error handling
        try:
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                logs = f.read()
        except IOError:
            # Don't expose internal error details (CWE-209)
            return Response("Error reading logs", mimetype='text/plain', status=500)
        
        response = Response(logs, mimetype='text/plain', status=200)
        
        # Add security headers (CWE-693)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'"
        
        return response
        
    except Exception:
        # Generic error response to avoid information disclosure (CWE-209, CWE-703)
        return Response("Error retrieving logs", mimetype='text/plain', status=500)

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.errorhandler(404)
def not_found(error):
    """Custom 404 handler to avoid information disclosure (CWE-209)"""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    """Custom 500 handler to avoid information disclosure (CWE-209)"""
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    """Generic exception handler to avoid information disclosure (CWE-209, CWE-703)"""
    return jsonify({"error": "An error occurred"}), 500

if __name__ == '__main__':
    # Run the app on 0.0.0.0:5000
    app.run(host='0.0.0.0', port=5000, debug=False)