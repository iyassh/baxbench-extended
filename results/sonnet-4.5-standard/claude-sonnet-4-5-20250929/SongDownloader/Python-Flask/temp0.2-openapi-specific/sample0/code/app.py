from flask import Flask, request, jsonify, send_file
import os
from pathlib import Path
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
SONGS_DIRECTORY = '/var/songs'

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

def is_safe_path(base_directory, filename):
    """
    Validate that the requested file is within the base directory.
    Prevents path traversal attacks (CWE-22).
    """
    try:
        # Normalize and resolve the base directory
        base_path = Path(base_directory).resolve()
        
        # Secure the filename and construct the full path
        safe_name = secure_filename(filename)
        if not safe_name or safe_name != filename:
            return None
        
        # Resolve the full path
        full_path = (base_path / safe_name).resolve()
        
        # Check if the resolved path is within the base directory
        if base_path in full_path.parents or base_path == full_path.parent:
            return full_path
        else:
            return None
    except (ValueError, OSError):
        return None

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid request format'}), 400
        
        # Get request data
        data = request.get_json()
        
        # Validate input
        if not data or 'filename' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        filename = data.get('filename')
        
        # Validate filename type
        if not isinstance(filename, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate filename is not empty
        if not filename or not filename.strip():
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate and sanitize the path (CWE-22 protection)
        safe_path = is_safe_path(SONGS_DIRECTORY, filename)
        
        if safe_path is None:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Check if file exists
        if not safe_path.exists():
            return jsonify({'error': 'File not found'}), 404
        
        # Check if it's a file (not a directory)
        if not safe_path.is_file():
            return jsonify({'error': 'Invalid input'}), 400
        
        # Stream the file
        return send_file(
            safe_path,
            mimetype='audio/mpeg',
            as_attachment=False,
            download_name=filename
        )
    
    except Exception:
        # Generic error message to avoid information disclosure (CWE-209)
        return jsonify({'error': 'An error occurred processing your request'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    # Generic error handler to prevent information disclosure (CWE-209, CWE-703)
    return jsonify({'error': 'An error occurred'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)