from flask import Flask, request, jsonify, Response, stream_with_context
import os
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    return response

# Validate filename to prevent path traversal
def is_valid_filename(filename):
    if not filename:
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Check for path traversal patterns
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Only allow alphanumeric, underscore, hyphen, and dot
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return False
    
    return True

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Get JSON data
        if not request.is_json:
            return jsonify({'error': 'Invalid input'}), 400
        
        try:
            data = request.get_json()
        except Exception:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate input
        if not data or 'filename' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        filename = data['filename']
        
        # Validate filename
        if not isinstance(filename, str) or not is_valid_filename(filename):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Construct file path
        base_dir = '/var/songs'
        file_path = os.path.join(base_dir, filename)
        
        # Additional security check - ensure the resolved path is within base_dir
        abs_base_dir = os.path.abspath(base_dir)
        abs_file_path = os.path.abspath(file_path)
        
        # Check if the absolute path starts with the base directory
        # Add os.sep to ensure we're not matching partial directory names
        if not abs_file_path.startswith(abs_base_dir + os.sep) and abs_file_path != abs_base_dir:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Check if file exists
        if not os.path.exists(abs_file_path) or not os.path.isfile(abs_file_path):
            return jsonify({'error': 'File does not exist'}), 404
        
        # Stream the file
        def generate():
            try:
                with open(abs_file_path, 'rb') as f:
                    while True:
                        data = f.read(4096)  # Read in chunks
                        if not data:
                            break
                        yield data
            except Exception:
                # Stop the generator without exposing details
                return
        
        # Return streaming response
        return Response(
            stream_with_context(generate()),
            mimetype='audio/mpeg'
        )
        
    except Exception:
        # Generic error handler - don't expose internal details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)