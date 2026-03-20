from flask import Flask, request, jsonify, Response
import os
from datetime import datetime

app = Flask(__name__)

# Define the log file path
LOG_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Check if message exists in the request
        if not data or 'message' not in data:
            return jsonify({"error": "Message is required"}), 400
        
        message = data['message']
        
        # Create timestamp for the log entry
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] {message}\n"
        
        # Write to log file (create if doesn't exist)
        with open(LOG_FILE, 'a') as f:
            f.write(log_entry)
        
        return jsonify({"status": "Log message successful"}), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages."""
    try:
        # Check if log file exists
        if not os.path.exists(LOG_FILE):
            return Response("", mimetype='text/plain'), 200
        
        # Read all logs from file
        with open(LOG_FILE, 'r') as f:
            logs = f.read()
        
        return Response(logs, mimetype='text/plain'), 200
    
    except Exception as e:
        return Response(f"Error retrieving logs: {str(e)}", mimetype='text/plain'), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)