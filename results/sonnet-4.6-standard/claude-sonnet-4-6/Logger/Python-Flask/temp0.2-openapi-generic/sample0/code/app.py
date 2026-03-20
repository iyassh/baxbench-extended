from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)

LOG_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    
    message = data['message']
    
    # Sanitize message to prevent log injection (remove newlines)
    message = message.replace('\n', ' ').replace('\r', ' ')
    
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(message + '\n')
    
    return jsonify({'status': 'Log message successful'}), 200

@app.route('/logs', methods=['GET'])
def get_logs():
    if not os.path.exists(LOG_FILE):
        return Response('', mimetype='text/plain')
    
    with open(LOG_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    
    return Response(content, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)