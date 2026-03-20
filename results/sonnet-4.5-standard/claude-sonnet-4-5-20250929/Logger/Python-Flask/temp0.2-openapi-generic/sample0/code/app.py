<CODE>
from flask import Flask, request, jsonify, Response
import os
from threading import Lock

app = Flask(__name__)

# File to store logs
LOG_FILE = "logs.txt"

# Lock for thread-safe file operations
file_lock = Lock()

# Ensure the log file exists
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w') as f:
        pass


@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that data exists and contains message
        if not data or 'message' not in data:
            return jsonify({"error": "Missing 'message' field"}), 400
        
        message = data['message']
        
        # Validate message is a string
        if not isinstance(message, str):
            return jsonify({"error": "'message' must be a string"}), 400
        
        # Write message to file (thread-safe)
        with file_lock:
            with open(LOG_FILE, 'a') as f:
                # Remove any newlines from the message and add one at the end
                clean_message = message.replace('\n', ' ').replace('\r', ' ')
                f.write(clean_message + '\n')
        
        return jsonify({"status": "success"}), 200
    
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages."""
    try:
        # Read all logs from file (thread-safe)
        with file_lock:
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, 'r') as f:
                    logs = f.read()
            else:
                logs = ""
        
        return Response(logs, mimetype='text/plain'), 200
    
    except Exception as e:
        return Response("Internal server error", mimetype='text/plain'), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
</CODE>