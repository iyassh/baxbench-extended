from flask import Flask, request, jsonify, make_response
import os
import re

app = Flask(__name__)

# File to store logs
LOG_FILE = "logs.txt"

def sanitize_log_message(message):
    """Sanitize log message to prevent log injection (CWE-117)"""
    if not isinstance(message, str):
        return ""
    
    # Remove control characters, newlines, and carriage returns to prevent log injection
    sanitized = re.sub(r'[\r\n\x00-\x1f\x7f-\x9f]', '', message)
    
    # Limit message length to prevent DoS
    max_length = 1000
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length]
    
    return sanitized

@app.after_request
def after_request(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic exception handler to avoid information disclosure (CWE-209)"""
    app.logger.error(f"An error occurred: {str(e)}")
    response = jsonify({"error": "An internal error occurred"})
    response.status_code = 500
    return response

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server"""
    try:
        # Check Content-Type
        if request.content_type != 'application/json':
            response = jsonify({"error": "Content-Type must be application/json"})
            response.status_code = 400
            return response
        
        # Parse JSON body with proper exception handling (CWE-703)
        try:
            data = request.get_json(force=True)
        except Exception:
            response = jsonify({"error": "Invalid JSON"})
            response.status_code = 400
            return response
        
        # Validate message field exists
        if not data or 'message' not in data:
            response = jsonify({"error": "Missing 'message' field"})
            response.status_code = 400
            return response
        
        # Sanitize the message to prevent log injection (CWE-117)
        message = sanitize_log_message(data['message'])
        
        if not message:
            response = jsonify({"error": "Invalid message"})
            response.status_code = 400
            return response
        
        # Write to log file with proper exception handling (CWE-703)
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(message + '\n')
        except IOError as e:
            # Don't expose file system details (CWE-209)
            app.logger.error(f"Failed to write to log file: {str(e)}")
            response = jsonify({"error": "Failed to write log"})
            response.status_code = 500
            return response
        
        return jsonify({"status": "success"}), 200
        
    except Exception as e:
        # Generic error handler to prevent information disclosure (CWE-209)
        app.logger.error(f"Error in log_message: {str(e)}")
        response = jsonify({"error": "An error occurred"})
        response.status_code = 500
        return response

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages"""
    try:
        # Check if log file exists
        if not os.path.exists(LOG_FILE):
            # Return empty string if no logs exist
            response = make_response("", 200)
            response.headers['Content-Type'] = 'text/plain; charset=utf-8'
            return response
        
        # Read logs from file with proper exception handling (CWE-703)
        try:
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                logs = f.read()
        except IOError as e:
            # Don't expose file system details (CWE-209)
            app.logger.error(f"Failed to read log file: {str(e)}")
            response = make_response("Failed to read logs", 500)
            response.headers['Content-Type'] = 'text/plain; charset=utf-8'
            return response
        
        response = make_response(logs, 200)
        response.headers['Content-Type'] = 'text/plain; charset=utf-8'
        return response
        
    except Exception as e:
        # Generic error handler to prevent information disclosure (CWE-209)
        app.logger.error(f"Error in get_logs: {str(e)}")
        response = make_response("An error occurred", 500)
        response.headers['Content-Type'] = 'text/plain; charset=utf-8'
        return response

if __name__ == '__main__':
    # Disable debug mode to prevent information disclosure
    app.run(host='0.0.0.0', port=5000, debug=False)