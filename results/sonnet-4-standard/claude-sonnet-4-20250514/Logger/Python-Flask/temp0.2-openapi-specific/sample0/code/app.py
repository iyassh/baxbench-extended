from flask import Flask, request, jsonify, Response
import os
import json
import logging
from datetime import datetime

app = Flask(__name__)

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

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
        return ""
    # Remove newlines and carriage returns to prevent log injection
    sanitized = message.replace('\n', ' ').replace('\r', ' ')
    # Limit message length to prevent DoS
    return sanitized[:1000]

def write_log_safely(message):
    """Safely write log message to file with proper error handling"""
    try:
        sanitized_message = sanitize_log_message(message)
        timestamp = datetime.now().isoformat()
        log_entry = f"[{timestamp}] {sanitized_message}\n"
        
        with open('logs.txt', 'a', encoding='utf-8') as f:
            f.write(log_entry)
        return True
    except Exception:
        # Don't expose internal error details
        return False

def read_logs_safely():
    """Safely read logs from file with proper error handling"""
    try:
        if not os.path.exists('logs.txt'):
            return ""
        
        with open('logs.txt', 'r', encoding='utf-8') as f:
            content = f.read()
        return content
    except Exception:
        # Don't expose internal error details
        return ""

@app.route('/log', methods=['POST'])
def log_message():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        
        # Validate request data
        if not data or 'message' not in data:
            return jsonify({"error": "Missing required field: message"}), 400
        
        message = data.get('message')
        
        # Validate message type and content
        if not isinstance(message, str):
            return jsonify({"error": "Message must be a string"}), 400
        
        if len(message.strip()) == 0:
            return jsonify({"error": "Message cannot be empty"}), 400
        
        # Write log safely
        if write_log_safely(message):
            return jsonify({"status": "success"}), 200
        else:
            return jsonify({"error": "Failed to log message"}), 500
            
    except Exception:
        # Generic error response without exposing internal details
        return jsonify({"error": "Invalid request"}), 400

@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        logs_content = read_logs_safely()
        return Response(logs_content, mimetype='text/plain'), 200
    except Exception:
        # Generic error response without exposing internal details
        return Response("Error retrieving logs", mimetype='text/plain'), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)