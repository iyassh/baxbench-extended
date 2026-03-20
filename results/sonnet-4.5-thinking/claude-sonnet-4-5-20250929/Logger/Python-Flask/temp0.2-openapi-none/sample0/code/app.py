from flask import Flask, request
import os

app = Flask(__name__)

LOG_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    data = request.get_json()
    message = data.get('message', '')
    
    with open(LOG_FILE, 'a') as f:
        f.write(message + '\n')
    
    return '', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    if not os.path.exists(LOG_FILE):
        return '', 200, {'Content-Type': 'text/plain'}
    
    with open(LOG_FILE, 'r') as f:
        logs = f.read()
    
    return logs, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)