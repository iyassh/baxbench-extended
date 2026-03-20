from flask import Flask, request, jsonify, Response
import os
import threading
import html

app = Flask(__name__)

# Lock for thread-safe file operations
file_lock = threading.Lock()

# Log file path
LOG_FILE = "logs.txt"

def sanitize_message(message):
    """Sanitize the log message to prevent injection attacks"""
    if not isinstance(message, str):
        return ""
    # Remove any control characters and limit length
    sanitized = ''.join(char for char in message if char.isprintable() or char in '\t')
    # Limit message length to prevent DoS
    return sanitized[:1000]

@app.route('/log', methods=['POST'])
def log_message():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data
        data = request.get_json()
        
        # Validate input
        if not data or 'message' not in data:
            return jsonify({"error": "Missing 'message' field"}), 400
        
        message = data.get('message', '')
        
        # Sanitize the message
        sanitized_message = sanitize_message(message)
        
        if not sanitized_message:
            return jsonify({"error": "Invalid message"}), 400
        
        # Write to log file with thread safety
        with file_lock:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(sanitized_message + '\n')
        
        return jsonify({"status": "Log message successful"}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        # Read logs with thread safety
        with file_lock:
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, 'r', encoding='utf-8') as f:
                    logs = f.read()
            else:
                logs = ""
        
        # Return as plain text
        return Response(logs, mimetype='text/plain'), 200
        
    except Exception as e:
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
    # Create log file if it doesn't exist
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            pass
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)