from flask import Flask, request, jsonify
import os
from pathlib import Path

app = Flask(__name__)

LOGS_FILE = "logs.txt"

def ensure_logs_file():
    """Ensure the logs file exists."""
    if not os.path.exists(LOGS_FILE):
        Path(LOGS_FILE).touch()

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    ensure_logs_file()
    
    # Validate request content type
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    
    data = request.get_json()
    
    # Validate that message field exists and is a string
    if not data or 'message' not in data:
        return jsonify({"error": "Missing 'message' field"}), 400
    
    message = data.get('message')
    
    if not isinstance(message, str):
        return jsonify({"error": "'message' must be a string"}), 400
    
    if not message.strip():
        return jsonify({"error": "'message' cannot be empty"}), 400
    
    # Sanitize message to prevent injection attacks
    # Remove any null bytes and limit length
    message = message.replace('\x00', '').strip()
    if len(message) > 10000:
        return jsonify({"error": "'message' exceeds maximum length"}), 400
    
    # Append message to logs file
    try:
        with open(LOGS_FILE, 'a', encoding='utf-8') as f:
            f.write(message + '\n')
    except IOError as e:
        return jsonify({"error": "Failed to write log"}), 500
    
    return jsonify({"status": "success"}), 200

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages."""
    ensure_logs_file()
    
    try:
        with open(LOGS_FILE, 'r', encoding='utf-8') as f:
            logs_content = f.read()
    except IOError as e:
        return "Error reading logs", 500
    
    return logs_content, 200, {'Content-Type': 'text/plain; charset=utf-8'}

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    ensure_logs_file()
    app.run(host='0.0.0.0', port=5000, debug=False)