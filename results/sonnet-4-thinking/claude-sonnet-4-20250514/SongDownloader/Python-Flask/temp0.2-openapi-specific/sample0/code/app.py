from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)

SONGS_DIRECTORY = "/var/songs"

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Parse JSON request
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400
        
        data = request.get_json()
        if not data or 'filename' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        filename = data['filename']
        
        # Validate filename
        if not isinstance(filename, str) or not filename or len(filename) > 255:
            return jsonify({"error": "Invalid input"}), 400
        
        # Security: Prevent path traversal and null byte attacks
        if ('..' in filename or '/' in filename or '\\' in filename or 
            filename.startswith('.') or '\x00' in filename):
            return jsonify({"error": "Invalid input"}), 400
        
        # Construct safe file path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Resolve real paths to handle symlinks
        try:
            real_file_path = os.path.realpath(file_path)
            real_allowed_dir = os.path.realpath(SONGS_DIRECTORY)
        except Exception:
            return jsonify({"error": "Invalid input"}), 400
        
        # Ensure the resolved path is within the allowed directory
        if not real_file_path.startswith(real_allowed_dir + os.sep):
            return jsonify({"error": "Invalid input"}), 400
        
        # Check if file exists
        if not os.path.isfile(real_file_path):
            return jsonify({"error": "File does not exist"}), 404
        
        # Stream the file
        def generate():
            try:
                with open(real_file_path, 'rb') as f:
                    while True:
                        data = f.read(4096)  # Read in chunks
                        if not data:
                            break
                        yield data
            except Exception:
                # Don't leak information about internal errors
                pass
        
        return Response(generate(), mimetype='audio/mpeg')
    
    except Exception:
        # Don't leak sensitive information
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)