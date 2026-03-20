import os
import json
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.exceptions import BadRequest, NotFound
import logging

app = Flask(__name__)

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Base directory for songs
SONGS_DIR = '/var/songs'

def validate_filename(filename):
    """Validate and sanitize filename to prevent path traversal attacks"""
    if not filename:
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Normalize the path and check for path traversal attempts
    normalized = os.path.normpath(filename)
    
    # Reject if contains path separators or parent directory references
    if '/' in normalized or '\\' in normalized or '..' in normalized:
        return False
    
    # Additional check for hidden files or system files
    if normalized.startswith('.'):
        return False
    
    return True

def safe_file_path(filename):
    """Construct safe file path within the songs directory"""
    if not validate_filename(filename):
        return None
    
    file_path = os.path.join(SONGS_DIR, filename)
    
    # Ensure the resolved path is within the songs directory
    try:
        real_songs_dir = os.path.realpath(SONGS_DIR)
        real_file_path = os.path.realpath(file_path)
        
        if not real_file_path.startswith(real_songs_dir + os.sep):
            return None
    except (OSError, ValueError):
        return None
    
    return file_path

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Validate content type
        if not request.is_json:
            abort(400)
        
        # Parse JSON request
        try:
            data = request.get_json(force=True)
        except (BadRequest, ValueError):
            abort(400)
        
        # Validate request structure
        if not isinstance(data, dict) or 'filename' not in data:
            abort(400)
        
        filename = data.get('filename')
        
        # Validate filename type
        if not isinstance(filename, str):
            abort(400)
        
        # Validate and construct safe file path
        file_path = safe_file_path(filename)
        if not file_path:
            abort(400)
        
        # Check if file exists and is a regular file
        try:
            if not os.path.exists(file_path) or not os.path.isfile(file_path):
                abort(404)
        except (OSError, ValueError):
            abort(404)
        
        # Additional security check - ensure file is readable
        try:
            if not os.access(file_path, os.R_OK):
                abort(404)
        except (OSError, ValueError):
            abort(404)
        
        # Stream the file
        try:
            return send_file(
                file_path,
                mimetype='audio/mpeg',
                as_attachment=False,
                download_name=filename
            )
        except (OSError, IOError):
            abort(404)
            
    except Exception:
        # Generic error handling to avoid information leakage
        abort(400)

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Invalid input'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'File does not exist'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure songs directory exists
    try:
        if not os.path.exists(SONGS_DIR):
            os.makedirs(SONGS_DIR, mode=0o755, exist_ok=True)
    except OSError:
        pass
    
    app.run(host='0.0.0.0', port=5000, debug=False)