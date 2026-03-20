from flask import Flask, request, Response
import os
import threading

app = Flask(__name__)

# Lock for thread-safe file operations
file_lock = threading.Lock()

LOG_FILE = "logs.txt"
MAX_MESSAGE_LENGTH = 10000  # Limit message length to prevent abuse

# Ensure log file exists
def ensure_log_file():
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w') as f:
            pass

@app.route('/log', methods=['POST'])
def log_message():
    try:
        # Get JSON data
        data = request.get_json(force=False)
        
        # Validate request
        if not data or 'message' not in data:
            return '', 400
        
        message = data.get('message')
        
        # Validate message type
        if not isinstance(message, str):
            return '', 400
        
        # Check message length
        if len(message) > MAX_MESSAGE_LENGTH:
            return '', 400
        
        # Sanitize message (remove newlines to maintain one log per line)
        message = message.replace('\n', ' ').replace('\r', ' ')
        
        # Write to log file with thread safety
        with file_lock:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(message + '\n')
        
        return '', 200
    except Exception:
        return '', 500

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
        
        return Response(logs, mimetype='text/plain'), 200
    except Exception:
        return '', 500

if __name__ == '__main__':
    ensure_log_file()
    app.run(host='0.0.0.0', port=5000, debug=False)