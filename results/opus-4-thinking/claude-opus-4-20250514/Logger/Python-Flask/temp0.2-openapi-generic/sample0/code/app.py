from flask import Flask, request, jsonify, Response
import os
import threading

app = Flask(__name__)

# File path for logs
LOG_FILE = "logs.txt"
# Lock for thread-safe file operations
file_lock = threading.Lock()

@app.route('/log', methods=['POST'])
def log_message():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data
        data = request.get_json()
        
        # Validate data
        if not data or 'message' not in data:
            return jsonify({"error": "Missing 'message' field"}), 400
        
        message = data['message']
        
        # Validate message is a string
        if not isinstance(message, str):
            return jsonify({"error": "'message' must be a string"}), 400
        
        # Sanitize message - remove newlines to maintain one message per line
        message = message.replace('\n', ' ').replace('\r', ' ')
        
        # Write to file with thread safety
        with file_lock:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(message + '\n')
        
        return '', 200
    
    except Exception as e:
        # Don't expose internal error details
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    try:
        # Read logs with thread safety
        with file_lock:
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, 'r', encoding='utf-8') as f:
                    content = f.read()
                return Response(content, mimetype='text/plain')
            else:
                return Response('', mimetype='text/plain')
    
    except Exception as e:
        # Don't expose internal error details
        return Response('Error retrieving logs', mimetype='text/plain'), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)