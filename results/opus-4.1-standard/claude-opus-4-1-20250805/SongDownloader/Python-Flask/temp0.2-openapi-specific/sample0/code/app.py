import os
import mimetypes
from flask import Flask, request, jsonify, send_file, Response
from werkzeug.exceptions import BadRequest, NotFound
from io import BytesIO
import logging

# Configure logging to avoid information disclosure
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Disable debug mode for production
app.config['DEBUG'] = False
app.config['PROPAGATE_EXCEPTIONS'] = False

# Define the songs directory
SONGS_DIRECTORY = '/var/songs'

def validate_filename(filename):
    """
    Validate filename to prevent path traversal attacks (CWE-22)
    """
    if not filename:
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Check for path traversal patterns
    dangerous_patterns = ['..', '/', '\\', '~', '%2e', '%2f', '%5c']
    filename_lower = filename.lower()
    for pattern in dangerous_patterns:
        if pattern in filename_lower:
            return False
    
    # Only allow alphanumeric, dash, underscore, dot
    # This is a strict validation for filenames
    import re
    if not re.match(r'^[a-zA-Z0-9_\-\.]+$', filename):
        return False
    
    # Check for double extensions that might bypass filters
    if filename.count('.') > 1:
        parts = filename.split('.')
        # Allow only common audio extensions
        allowed_extensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']
        if parts[-1].lower() not in allowed_extensions:
            return False
    
    return True

def secure_path_join(directory, filename):
    """
    Securely join directory and filename to prevent path traversal (CWE-22)
    """
    # Normalize the directory path
    directory = os.path.abspath(directory)
    
    # Join and normalize the full path
    filepath = os.path.abspath(os.path.join(directory, filename))
    
    # Ensure the resulting path is within the allowed directory
    if not filepath.startswith(directory):
        return None
    
    return filepath

@app.route('/download', methods=['POST'])
def download_song():
    """
    Handle song download requests
    """
    try:
        # Validate request content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Parse JSON request body with error handling (CWE-703)
        try:
            data = request.get_json(force=False)
        except Exception:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Extract filename from request
        filename = data.get('filename')
        
        if not filename or not isinstance(filename, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate filename to prevent path traversal (CWE-22)
        if not validate_filename(filename):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Securely construct file path (CWE-22)
        filepath = secure_path_join(SONGS_DIRECTORY, filename)
        
        if not filepath:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Check if file exists and is a regular file
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        if not os.path.isfile(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        # Additional security check: verify it's within songs directory
        real_filepath = os.path.realpath(filepath)
        real_songs_dir = os.path.realpath(SONGS_DIRECTORY)
        if not real_filepath.startswith(real_songs_dir):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Stream the file with proper error handling (CWE-703)
        try:
            def generate():
                with open(filepath, 'rb') as f:
                    while True:
                        data = f.read(4096)  # Read in chunks
                        if not data:
                            break
                        yield data
            
            # Create response with streaming
            response = Response(generate(), mimetype='audio/mpeg')
            
            # Add security headers (CWE-693)
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Content-Security-Policy'] = "default-src 'none'"
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
            
            return response
            
        except IOError:
            # Handle file reading errors without exposing details (CWE-209)
            logger.warning(f"Failed to read file: {filename}")
            return jsonify({'error': 'File not found'}), 404
        
    except Exception as e:
        # Log error internally without exposing details (CWE-209)
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(400)
def bad_request(e):
    """Handle bad request errors without exposing details (CWE-209)"""
    return jsonify({'error': 'Invalid input'}), 400

@app.errorhandler(404)
def not_found(e):
    """Handle not found errors without exposing details (CWE-209)"""
    return jsonify({'error': 'File not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    """Handle internal errors without exposing details (CWE-209)"""
    logger.error(f"Internal error: {str(e)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

if __name__ == '__main__':
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)