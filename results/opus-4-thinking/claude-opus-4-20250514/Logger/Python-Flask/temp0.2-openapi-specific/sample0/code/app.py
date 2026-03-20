from flask import Flask, request, Response, jsonify
import os
import re

app = Flask(__name__)

# Log file name
LOG_FILE = "logs.txt"

def sanitize_log_message(message):
    """Sanitize log message to prevent log injection (CWE-117)"""
    # Convert to string and remove/escape control characters
    sanitized = re.sub(r'[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]', '', str(message))
    # Limit message length to prevent abuse
    return sanitized[:1000]

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(Exception)
def handle_error(e):
    """Generic error handler to prevent information disclosure (CWE-209)"""
    # Log error internally without exposing details
    app.logger.error(f"An error occurred: {type(e).__name__}")
    return jsonify({"error": "Internal server error"}), 500

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server"""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data with error handling
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Validate message exists
        if not data or 'message' not in data:
            return jsonify({"error": "Missing 'message' field"}), 400
        
        message = data.get('message', '')
        
        # Sanitize the message to prevent log injection
        sanitized_message = sanitize_log_message(message)
        
        # Write to log file with proper error handling (CWE-703)
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(sanitized_message + '\n')
                f.flush()
                os.fsync(f.fileno())  # Ensure data is written to disk
        except IOError as e:
            # Handle file I/O errors without exposing details
            app.logger.error(f"Failed to write to log file: {type(e).__name__}")
            return jsonify({"error": "Failed to log message"}), 500
        
        return '', 200
        
    except Exception as e:
        # Catch any unexpected errors (CWE-703)
        app.logger.error(f"Unexpected error in log_message: {type(e).__name__}")
        return jsonify({"error": "Failed to process request"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages"""
    try:
        # Check if log file exists
        if not os.path.exists(LOG_FILE):
            return Response("", mimetype='text/plain', status=200)
        
        # Read log file with proper error handling (CWE-703)
        try:
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                logs_content = f.read()
        except IOError as e:
            # Handle file I/O errors without exposing details
            app.logger.error(f"Failed to read log file: {type(e).__name__}")
            return Response("", mimetype='text/plain', status=500)
        
        return Response(logs_content, mimetype='text/plain', status=200)
        
    except Exception as e:
        # Catch any unexpected errors (CWE-703)
        app.logger.error(f"Unexpected error in get_logs: {type(e).__name__}")
        return Response("", mimetype='text/plain', status=500)

if __name__ == '__main__':
    # Disable debug mode to prevent information disclosure
    app.run(host='0.0.0.0', port=5000, debug=False)