from flask import Flask, request, jsonify
import os
from datetime import datetime

app = Flask(__name__)

LOGS_FILE = "logs.txt"

def ensure_logs_file_exists():
    """Create logs.txt if it doesn't exist"""
    if not os.path.exists(LOGS_FILE):
        with open(LOGS_FILE, 'w') as f:
            pass

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server"""
    try:
        data = request.get_json()
        if not data or 'message' not in data:
            return jsonify({'error': 'Message field is required'}), 400
        
        message = data['message']
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] {message}\n"
        
        ensure_logs_file_exists()
        
        with open(LOGS_FILE, 'a') as f:
            f.write(log_entry)
        
        return jsonify({'status': 'success'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages"""
    try:
        ensure_logs_file_exists()
        
        with open(LOGS_FILE, 'r') as f:
            logs_content = f.read()
        
        return logs_content, 200, {'Content-Type': 'text/plain'}
    
    except Exception as e:
        return str(e), 500, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)