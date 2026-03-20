from flask import Flask, request, jsonify, send_file
import os
import re
from werkzeug.utils import secure_filename
import mimetypes

app = Flask(__name__)

# Directory where songs are stored
SONGS_DIRECTORY = '/var/songs'

# Allowed audio file extensions
ALLOWED_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'}

def is_safe_path(basedir, path):
    """Check if the path is safe and within the base directory"""
    # Resolve the absolute path
    resolved_path = os.path.abspath(os.path.join(basedir, path))
    # Check if the resolved path is within the base directory
    return resolved_path.startswith(os.path.abspath(basedir))

def validate_filename(filename):
    """Validate that the filename is safe and has an allowed extension"""
    if not filename:
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Check for directory traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Check if filename matches a safe pattern (alphanumeric, spaces, dashes, underscores, dots)
    if not re.match(r'^[a-zA-Z0-9_\-\. ]+$', filename):
        return False
    
    # Check file extension
    _, ext = os.path.splitext(filename.lower())
    if ext not in ALLOWED_EXTENSIONS:
        return False
    
    return True

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Check if request has JSON content
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that filename is provided
        if not data or 'filename' not in data:
            return jsonify({'error': 'Missing filename parameter'}), 400
        
        filename = data['filename']
        
        # Validate filename
        if not validate_filename(filename):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Use secure_filename for additional safety
        safe_filename = secure_filename(filename)
        
        # Construct the full file path
        file_path = os.path.join(SONGS_DIRECTORY, safe_filename)
        
        # Additional path traversal check
        if not is_safe_path(SONGS_DIRECTORY, safe_filename):
            return jsonify({'error': 'Invalid file path'}), 400
        
        # Check if file exists
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Check if it's a regular file (not a directory or symlink)
        if not os.path.isfile(file_path):
            return jsonify({'error': 'Not a valid file'}), 400
        
        # Determine the mimetype
        mimetype = 'audio/mpeg'  # Default for mp3
        guessed_type, _ = mimetypes.guess_type(file_path)
        if guessed_type and guessed_type.startswith('audio/'):
            mimetype = guessed_type
        
        # Stream the file to the client
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=True,
            download_name=safe_filename
        )
        
    except Exception as e:
        # Log the error in production, but don't expose internal details
        app.logger.error(f"Error in download_song: {str(e)}")
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
    # Create songs directory if it doesn't exist
    if not os.path.exists(SONGS_DIRECTORY):
        os.makedirs(SONGS_DIRECTORY, exist_ok=True)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)