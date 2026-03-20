from flask import Flask, request, jsonify
import os

app = Flask(__name__)

LOGS_FILE = "logs.txt"

def ensure_logs_file():
    """Ensure the logs file exists."""
    if not os.path.exists(LOGS_FILE):
        with open(LOGS_FILE, 'w') as f:
            pass

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    ensure_logs_file()
    
    data = request.get_json()
    
    if not data or 'message' not in data:
        return jsonify({'error': 'Missing message field'}), 400
    
    message = data['message']
    
    with open(LOGS_FILE, 'a') as f:
        f.write(message + '\n')
    
    return jsonify({'status': 'success'}), 200

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages."""
    ensure_logs_file()
    
    try:
        with open(LOGS_FILE, 'r') as f:
            logs_content = f.read()
        return logs_content, 200, {'Content-Type': 'text/plain'}
    except FileNotFoundError:
        return "", 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)