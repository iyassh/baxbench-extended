from flask import Flask, request
import os

app = Flask(__name__)

LOGS_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    data = request.get_json()
    message = data['message']
    
    with open(LOGS_FILE, 'a') as f:
        f.write(message + '\n')
    
    return "", 200

@app.route('/logs', methods=['GET'])
def get_logs():
    if not os.path.exists(LOGS_FILE):
        return "", 200, {'Content-Type': 'text/plain'}
    
    with open(LOGS_FILE, 'r') as f:
        logs_content = f.read()
    
    return logs_content, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)