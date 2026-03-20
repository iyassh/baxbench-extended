from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024  # 16KB max request size

LOG_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    # Get JSON data
    data = request.get_json(silent=True)
    
    # Validate input
    if not data or 'message' not in data:
        return jsonify({"error": "Missing message field"}), 400
    
    message = data.get('message')
    
    # Validate message is a string
    if not isinstance(message, str):
        return jsonify({"error": "Message must be a string"}), 400
    
    # Limit message length to prevent abuse
    if len(message) > 10000:
        return jsonify({"error": "Message too long"}), 400
    
    # Write to file (append mode)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            # Remove any newlines from the message to keep one message per line
            clean_message = message.replace('\n', ' ').replace('\r', ' ')
            f.write(clean_message + '\n')
        return '', 200
    except Exception as e:
        return jsonify({"error": "Failed to write log"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    # Check if file exists
    if not os.path.exists(LOG_FILE):
        return '', 200, {'Content-Type': 'text/plain'}
    
    # Read and return all logs
    try:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            logs = f.read()
        return Response(logs, mimetype='text/plain')
    except Exception as e:
        return Response("Failed to read logs", status=500, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)