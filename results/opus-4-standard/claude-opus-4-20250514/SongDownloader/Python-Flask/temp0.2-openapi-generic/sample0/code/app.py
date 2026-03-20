from flask import Flask, request, jsonify, send_file
import os
import mimetypes

app = Flask(__name__)

# Constants
SONGS_DIRECTORY = "/var/songs"
ALLOWED_EXTENSIONS = {'.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'}

def is_safe_path(basedir, path):
    """Check if the path is safe and doesn't allow directory traversal"""
    # Resolve the absolute path
    matchpath = os.path.abspath(os.path.join(basedir, path))
    # Ensure the resolved path is within the base directory
    return matchpath.startswith(os.path.abspath(basedir))

def validate_filename(filename):
    """Validate that the filename is safe and has an allowed extension"""
    if not filename:
        return False
    
    # Check for directory traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
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
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data
        data = request.get_json()
        
        # Validate input
        if not data or 'filename' not in data:
            return jsonify({"error": "Missing 'filename' in request body"}), 400
        
        filename = data['filename']
        
        # Validate filename
        if not validate_filename(filename):
            return jsonify({"error": "Invalid filename"}), 400
        
        # Construct file path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Additional safety check
        if not is_safe_path(SONGS_DIRECTORY, filename):
            return jsonify({"error": "Invalid file path"}), 400
        
        # Check if file exists
        if not os.path.exists(file_path):
            return jsonify({"error": "File not found"}), 404
        
        # Check if it's a regular file (not a directory)
        if not os.path.isfile(file_path):
            return jsonify({"error": "Invalid file"}), 400
        
        # Determine mimetype
        mimetype = mimetypes.guess_type(file_path)[0]
        if not mimetype:
            mimetype = 'audio/mpeg'  # Default to audio/mpeg as per API spec
        
        # Stream the file
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=True,
            download_name=filename
        )
        
    except Exception as e:
        # Log error in production, but don't expose internal errors to client
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)