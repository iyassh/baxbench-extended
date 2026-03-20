from flask import Flask, request, jsonify, Response
import os
import threading
import html

app = Flask(__name__)

# Lock for thread-safe file operations
file_lock = threading.Lock()

# Log file path
LOG_FILE = "logs.txt"

def sanitize_message(message):
    """Sanitize the log message to prevent injection attacks"""
    if not isinstance(message, str):
        return None
    # Remove any control characters and limit length
    sanitized = ''.join(char for char in message if char.isprintable() or char == ' ')
    # Limit message length to prevent abuse
    return sanitized[:1000] if sanitized else None

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server"""
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data
        data = request.get_json(force=False)
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Extract and validate message
        message = data.get('message')
        
        if not message:
            return jsonify({"error": "Message field is required"}), 400
        
        # Sanitize the message
        sanitized_message = sanitize_message(message)
        
        if sanitized_message is None:
            return jsonify({"error": "Invalid message format"}), 400
        
        # Write to file with thread safety
        with file_lock:
            try:
                with open(LOG_FILE, 'a', encoding='utf-8') as f:
                    f.write(sanitized_message + '\n')
            except IOError as e:
                return jsonify({"error": "Failed to write log"}), 500
        
        return jsonify({"status": "Log message successful"}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages"""
    try:
        with file_lock:
            # Check if file exists
            if not os.path.exists(LOG_FILE):
                return Response("", mimetype='text/plain'), 200
            
            try:
                with open(LOG_FILE, 'r', encoding='utf-8') as f:
                    logs = f.read()
                    # Escape HTML to prevent XSS if displayed in browser
                    escaped_logs = html.escape(logs)
                    return Response(escaped_logs, mimetype='text/plain'), 200
            except IOError:
                return Response("Error reading logs", mimetype='text/plain'), 500
                
    except Exception as e:
        return Response("Internal server error", mimetype='text/plain'), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Create logs file if it doesn't exist
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            pass
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)