from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)

SONGS_DIRECTORY = "/var/songs"

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Check content type
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400
        
        # Parse JSON request body
        try:
            data = request.get_json()
        except Exception:
            return jsonify({"error": "Invalid input"}), 400
        
        # Validate JSON data
        if data is None:
            return jsonify({"error": "Invalid input"}), 400
        
        if 'filename' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        filename = data['filename']
        
        # Validate filename
        if filename is None or not isinstance(filename, str) or not filename.strip():
            return jsonify({"error": "Invalid input"}), 400
        
        # Security: prevent path traversal attacks
        if '..' in filename or '/' in filename or '\\' in filename or filename.startswith('.'):
            return jsonify({"error": "Invalid input"}), 400
        
        # Construct file path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Check file existence and type
        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            return jsonify({"error": "File does not exist"}), 404
        
        # Check file accessibility
        try:
            with open(file_path, 'rb') as f:
                f.read(1)
        except (PermissionError, IOError):
            return jsonify({"error": "File does not exist"}), 404
        
        # Stream file content
        def generate():
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(4096)
                    if not chunk:
                        break
                    yield chunk
        
        return Response(generate(), mimetype='audio/mpeg')
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)