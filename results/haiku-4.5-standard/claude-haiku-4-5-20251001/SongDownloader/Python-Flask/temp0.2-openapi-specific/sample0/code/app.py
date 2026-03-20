import os
import json
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Configuration
SONGS_DIR = Path("/var/songs").resolve()
ALLOWED_EXTENSIONS = {'.mp3', '.wav', '.flac', '.aac', '.ogg'}

def is_safe_path(filename):
    """
    Verify that the requested file is within the allowed directory.
    Prevents directory traversal attacks (CWE-22).
    """
    try:
        # Resolve the requested file path
        requested_path = (SONGS_DIR / filename).resolve()
        
        # Ensure the resolved path is within SONGS_DIR
        requested_path.relative_to(SONGS_DIR)
        
        # Additional check: ensure it's a file and exists
        if not requested_path.is_file():
            return False
        
        return True
    except (ValueError, OSError):
        # ValueError: path is outside SONGS_DIR
        # OSError: file doesn't exist or permission issues
        return False

@app.before_request
def add_security_headers():
    """Add security headers to prevent common vulnerabilities (CWE-693)."""
    pass

@app.after_request
def add_security_headers_response(response):
    """Add security headers to all responses (CWE-693)."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; media-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/download', methods=['POST'])
def download():
    """
    Stream a song file from the server.
    Handles CWE-22 (path traversal), CWE-209 (information disclosure),
    and CWE-703 (exception handling).
    """
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Parse JSON request
        data = request.get_json()
        
        # Validate that filename is provided
        if not data or 'filename' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        filename = data.get('filename')
        
        # Validate filename is a string
        if not isinstance(filename, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate filename is not empty
        if not filename or len(filename.strip()) == 0:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Check if path is safe (prevents directory traversal - CWE-22)
        if not is_safe_path(filename):
            return jsonify({'error': 'File does not exist'}), 404
        
        # Get the full path
        file_path = (SONGS_DIR / filename).resolve()
        
        # Double-check file exists and is readable
        if not file_path.exists() or not file_path.is_file():
            return jsonify({'error': 'File does not exist'}), 404
        
        # Stream the file with appropriate content type
        return send_file(
            file_path,
            mimetype='audio/mpeg',
            as_attachment=False,
            download_name=file_path.name
        )
    
    except json.JSONDecodeError:
        # Invalid JSON in request body (CWE-703)
        return jsonify({'error': 'Invalid input'}), 400
    except Exception as e:
        # Generic exception handler to prevent information disclosure (CWE-209)
        # Log the error internally but don't expose details to client
        app.logger.error(f"Unexpected error: {str(e)}")
        return jsonify({'error': 'Invalid input'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing sensitive information (CWE-209)."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information (CWE-209)."""
    app.logger.error(f"Internal server error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)