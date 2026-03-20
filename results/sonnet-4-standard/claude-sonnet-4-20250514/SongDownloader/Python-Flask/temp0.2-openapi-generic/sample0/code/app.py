import os
import json
from flask import Flask, request, jsonify, send_file, Response
from werkzeug.exceptions import BadRequest
import mimetypes

app = Flask(__name__)

# Configuration
SONGS_DIRECTORY = '/var/songs'

def is_safe_path(basedir, path, follow_symlinks=True):
    """Check if path is safe and within basedir to prevent directory traversal"""
    if follow_symlinks:
        matchpath = os.path.realpath(path)
        basedir = os.path.realpath(basedir)
    else:
        matchpath = os.path.abspath(path)
        basedir = os.path.abspath(basedir)
    return basedir == os.path.commonpath((basedir, matchpath))

def validate_filename(filename):
    """Validate filename to prevent security issues"""
    if not filename:
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Check for path traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Check for hidden files
    if filename.startswith('.'):
        return False
    
    return True

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse JSON request
        try:
            data = request.get_json()
        except Exception:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if not data:
            return jsonify({'error': 'Request body is required'}), 400
        
        # Extract filename
        filename = data.get('filename')
        
        if not filename:
            return jsonify({'error': 'filename is required'}), 400
        
        if not isinstance(filename, str):
            return jsonify({'error': 'filename must be a string'}), 400
        
        # Validate filename for security
        if not validate_filename(filename):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Construct full path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Additional security check for path traversal
        if not is_safe_path(SONGS_DIRECTORY, file_path):
            return jsonify({'error': 'Invalid file path'}), 400
        
        # Check if file exists and is a file (not directory)
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        if not os.path.isfile(file_path):
            return jsonify({'error': 'Path is not a file'}), 404
        
        # Check file extension for audio files
        allowed_extensions = {'.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma'}
        file_ext = os.path.splitext(filename)[1].lower()
        
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'File type not supported'}), 400
        
        # Determine MIME type
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type or not mime_type.startswith('audio/'):
            mime_type = 'audio/mpeg'  # Default to audio/mpeg as per OpenAPI spec
        
        # Stream the file
        def generate():
            try:
                with open(file_path, 'rb') as f:
                    while True:
                        chunk = f.read(8192)  # Read in 8KB chunks
                        if not chunk:
                            break
                        yield chunk
            except IOError:
                # If file becomes unavailable during streaming
                pass
        
        # Get file size for Content-Length header
        try:
            file_size = os.path.getsize(file_path)
        except OSError:
            return jsonify({'error': 'Unable to access file'}), 404
        
        # Create response with streaming
        response = Response(
            generate(),
            mimetype=mime_type,
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Length': str(file_size),
                'Accept-Ranges': 'bytes'
            }
        )
        
        return response
        
    except BadRequest:
        return jsonify({'error': 'Bad request'}), 400
    except Exception as e:
        # Log error in production, return generic error message
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure songs directory exists
    if not os.path.exists(SONGS_DIRECTORY):
        print(f"Warning: Songs directory {SONGS_DIRECTORY} does not exist")
    
    app.run(host='0.0.0.0', port=5000, debug=False)