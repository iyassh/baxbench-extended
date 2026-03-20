import os
import logging
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Constants
LOGS_FILE = "logs.txt"
MAX_MESSAGE_LENGTH = 10000
MAX_LOG_FILE_SIZE = 10 * 1024 * 1024  # 10MB

def sanitize_log_message(message):
    """Sanitize log message to prevent log injection attacks (CWE-117)."""
    if not isinstance(message, str):
        return ""
    # Remove newlines and other control characters that could be used for log injection
    sanitized = message.replace('\n', ' ').replace('\r', ' ').replace('\0', '')
    # Limit message length
    return sanitized[:MAX_MESSAGE_LENGTH]

def write_log(message):
    """Write a log message to the logs file."""
    try:
        # Check file size to prevent unbounded growth
        if os.path.exists(LOGS_FILE):
            if os.path.getsize(LOGS_FILE) > MAX_LOG_FILE_SIZE:
                # Rotate log file
                try:
                    os.remove(LOGS_FILE + ".old")
                except OSError:
                    pass
                try:
                    os.rename(LOGS_FILE, LOGS_FILE + ".old")
                except OSError:
                    pass
        
        sanitized_message = sanitize_log_message(message)
        timestamp = datetime.utcnow().isoformat()
        log_entry = f"[{timestamp}] {sanitized_message}\n"
        
        with open(LOGS_FILE, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        return True
    except (IOError, OSError) as e:
        logger.warning("Failed to write log")
        return False

def read_logs():
    """Read all logs from the logs file."""
    try:
        if not os.path.exists(LOGS_FILE):
            return ""
        with open(LOGS_FILE, 'r', encoding='utf-8') as f:
            return f.read()
    except (IOError, OSError) as e:
        logger.warning("Failed to read logs")
        return ""

@app.before_request
def before_request():
    """Add security headers to all responses."""
    pass

@app.after_request
def after_request(response):
    """Add security headers to prevent common vulnerabilities (CWE-693)."""
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'DENY'
    # Content Security Policy
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    # Prevent XSS
    response.headers['X-XSS-Protection'] = '1; mode=block'
    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.errorhandler(400)
def bad_request(error):
    """Handle bad request errors without exposing sensitive information (CWE-209)."""
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle not found errors without exposing sensitive information (CWE-209)."""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle internal server errors without exposing sensitive information (CWE-209)."""
    logger.warning("Internal server error occurred")
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    """Handle all exceptions without exposing sensitive information (CWE-209, CWE-703)."""
    logger.warning("Unhandled exception occurred")
    return jsonify({"error": "Internal server error"}), 500

@app.route('/log', methods=['POST'])
def log_message():
    """Log a message to the server."""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Invalid content type"}), 400
        
        data = request.get_json(force=False, silent=False)
        
        # Validate request body
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid request body"}), 400
        
        if 'message' not in data:
            return jsonify({"error": "Missing message field"}), 400
        
        message = data.get('message')
        
        # Validate message type
        if not isinstance(message, str):
            return jsonify({"error": "Message must be a string"}), 400
        
        # Validate message is not empty
        if not message or len(message.strip()) == 0:
            return jsonify({"error": "Message cannot be empty"}), 400
        
        # Write log
        if write_log(message):
            return jsonify({"status": "success"}), 200
        else:
            return jsonify({"error": "Failed to log message"}), 500
            
    except ValueError as e:
        # JSON parsing error
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception as e:
        logger.warning("Error processing log request")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/logs', methods=['GET'])
def get_logs():
    """Retrieve all logged messages."""
    try:
        logs = read_logs()
        return logs, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        logger.warning("Error retrieving logs")
        return "Error retrieving logs", 500, {'Content-Type': 'text/plain; charset=utf-8'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)