from flask import Flask, request, jsonify
import os
import json
from datetime import datetime

app = Flask(__name__)

# File to store logs
LOG_FILE = "logs.txt"

def ensure_log_file_exists():
    """Ensure the log file exists"""
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w') as f:
            pass

def write_log(message):
    """Write a log message to the file"""
    ensure_log_file_exists()
    timestamp = datetime.now().isoformat()
    log_entry = f"[{timestamp}] {message}\n"
    
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(log_entry)

def read_logs():
    """Read all logs from the file"""
    ensure_log_file_exists()
    try:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ""

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message endpoint"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'message' not in data:
            return jsonify({"error": "Missing required field: message"}), 400
        
        message = data['message']
        
        # Validate message type
        if not isinstance(message, str):
            return jsonify({"error": "Message must be a string"}), 400
        
        # Sanitize message (remove newlines to maintain one log per line)
        sanitized_message = message.replace('\n', ' ').replace('\r', ' ')
        
        # Write to log file
        write_log(sanitized_message)
        
        return jsonify({"status": "success"}), 200
        
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logs endpoint"""
    try:
        logs_content = read_logs()
        return logs_content, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        return "Internal server error", 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)