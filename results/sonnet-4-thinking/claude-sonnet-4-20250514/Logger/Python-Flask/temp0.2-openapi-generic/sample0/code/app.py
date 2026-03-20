from flask import Flask, request, jsonify
import os

app = Flask(__name__)

LOG_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    
    data = request.get_json()
    
    # Validate that message field exists
    if not data or 'message' not in data:
        return jsonify({"error": "message field is required"}), 400
    
    message = data['message']
    
    # Validate message is a string
    if not isinstance(message, str):
        return jsonify({"error": "message must be a string"}), 400
    
    # Limit message length for security
    if len(message) > 10000:
        return jsonify({"error": "message too long"}), 400
    
    # Remove newlines to maintain one message per line format
    message = message.replace('\n', ' ').replace('\r', ' ')
    
    # Append message to log file
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(message + '\n')
    except Exception:
        return jsonify({"error": "Failed to write log"}), 500
    
    return '', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    # Check if log file exists
    if not os.path.exists(LOG_FILE):
        return '', 200, {'Content-Type': 'text/plain'}
    
    # Read all logs
    try:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            logs = f.read()
    except Exception:
        return "Failed to read logs", 500, {'Content-Type': 'text/plain'}
    
    return logs, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)