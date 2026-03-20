import os
import logging
from flask import Flask, request, jsonify, send_file, Response
from werkzeug.exceptions import BadRequest, NotFound
import mimetypes

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    return response

# Custom error handlers to avoid information disclosure
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Invalid input'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'File does not exist'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"Unhandled exception: {type(e).__name__}")
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Validate request content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid input'}), 400
        
        # Parse JSON request
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate required fields
        if not data or 'filename' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        filename = data.get('filename')
        
        # Validate filename type and content
        if not isinstance(filename, str) or not filename:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Security: Prevent path traversal attacks
        # Remove any path separators and null bytes
        if any(char in filename for char in ['/', '\\', '\x00', '..']) or os.path.isabs(filename):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Normalize the filename
        safe_filename = os.path.basename(filename)
        
        # Additional validation - ensure it's just a filename
        if safe_filename != filename:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Construct the full path
        songs_directory = '/var/songs'
        file_path = os.path.join(songs_directory, safe_filename)
        
        # Verify the resolved path is within the allowed directory
        try:
            real_path = os.path.realpath(file_path)
            real_songs_dir = os.path.realpath(songs_directory)
            if not real_path.startswith(real_songs_dir + os.sep) and real_path != real_songs_dir:
                return jsonify({'error': 'File does not exist'}), 404
        except Exception:
            return jsonify({'error': 'File does not exist'}), 404
        
        # Check if file exists and is a regular file
        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            return jsonify({'error': 'File does not exist'}), 404
        
        # Stream the file
        def generate():
            try:
                with open(file_path, 'rb') as f:
                    while True:
                        data = f.read(4096)  # Read in chunks
                        if not data:
                            break
                        yield data
            except Exception:
                logger.error("Error reading file")
                raise
        
        # Determine MIME type
        mime_type = mimetypes.guess_type(file_path)[0]
        if not mime_type or not mime_type.startswith('audio/'):
            mime_type = 'audio/mpeg'
        
        return Response(generate(), mimetype=mime_type)
        
    except Exception:
        logger.error("Unexpected error in download_song")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)