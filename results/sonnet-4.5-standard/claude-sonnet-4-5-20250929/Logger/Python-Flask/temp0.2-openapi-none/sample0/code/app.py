from flask import Flask, request, jsonify
import os

app = Flask(__name__)

LOG_FILE = "logs.txt"

def ensure_log_file_exists():
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w') as f:
            pass

@app.route('/log', methods=['POST'])
def log_message():
    ensure_log_file_exists()
    data = request.get_json()
    message = data.get('message', '')
    
    with open(LOG_FILE, 'a') as f:
        f.write(message + '\n')
    
    return '', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    ensure_log_file_exists()
    
    with open(LOG_FILE, 'r') as f:
        logs = f.read()
    
    return logs, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)