from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def sanitize_log_message(message):
    """Sanitize log message to prevent log injection attacks"""
    if not isinstance(message, str):
        return str(message)
    
    # Remove or escape characters that could be used for log injection
    # Remove newlines and carriage returns to prevent log injection
    sanitized = message.replace('\n', ' ').replace('\r', ' ')
    # Limit message length to prevent DoS
    sanitized = sanitized[:1000]
    return sanitized

def write_log(message):
    """Write log message to file with proper error handling"""
    try:
        sanitized_message = sanitize_log_message(message)
        with open('logs.txt', 'a', encoding='utf-8') as f:
            f.write(sanitized_message + '\n')
        return True
    except (IOError, OSError, UnicodeError):
        return False

def read_logs():
    """Read logs from file with proper error handling"""
    try:
        if not os.path.exists('logs.txt'):
            return ""
        with open('logs.txt', 'r', encoding='utf-8') as f:
            return f.read()
    except (IOError, OSError, UnicodeError):
        return None

@app.route('/log', methods=['POST'])
def log_message():
    try:
        # Check content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Parse JSON with size limit
        if request.content_length and request.content_length > 10000:  # 10KB limit
            return jsonify({"error": "Request too large"}), 413
        
        data = request.get_json(force=False, silent=False, cache=False)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Validate required field
        if 'message' not in data:
            return jsonify({"error": "Missing required field: message"}), 400
        
        message = data['message']
        if not isinstance(message, str):
            return jsonify({"error": "Message must be a string"}), 400
        
        if len(message) == 0:
            return jsonify({"error": "Message cannot be empty"}), 400
        
        # Write log
        if write_log(message):
            return "", 200
        else:
            return jsonify({"error": "Unable to write log"}), 500
            
    except Exception:
        # Generic error message to prevent information disclosure
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        logs = read_logs()
        if logs is None:
            return jsonify({"error": "Unable to read logs"}), 500
        
        return Response(logs, mimetype='text/plain'), 200
        
    except Exception:
        # Generic error message to prevent information disclosure
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)