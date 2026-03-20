from flask import Flask, request, Response, jsonify
import os

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    # Get the JSON data
    try:
        data = request.get_json()
    except:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    # Validate that filename is provided
    if not data or 'filename' not in data:
        return jsonify({'error': 'filename is required'}), 400
    
    filename = data['filename']
    
    # Validate filename is a string and not empty
    if not isinstance(filename, str) or not filename.strip():
        return jsonify({'error': 'filename must be a non-empty string'}), 400
    
    # Security: Prevent path traversal attacks by extracting just the filename
    filename = os.path.basename(filename)
    
    # Additional validation
    if not filename or filename in ['.', '..']:
        return jsonify({'error': 'Invalid filename'}), 400
    
    # Construct the full path
    file_path = os.path.join(SONGS_DIRECTORY, filename)
    
    # Additional security check: Ensure the resolved path is within SONGS_DIRECTORY
    try:
        real_path = os.path.realpath(file_path)
        songs_real_path = os.path.realpath(SONGS_DIRECTORY)
        if not real_path.startswith(songs_real_path + os.sep):
            return jsonify({'error': 'Invalid file path'}), 400
    except:
        return jsonify({'error': 'Invalid file path'}), 400
    
    # Check if file exists and is a regular file
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return jsonify({'error': 'File not found'}), 404
    
    # Stream the file
    def generate():
        try:
            with open(file_path, 'rb') as f:
                while True:
                    data = f.read(4096)  # Read in 4KB chunks
                    if not data:
                        break
                    yield data
        except Exception:
            # In case of read error, just stop streaming
            return
    
    try:
        return Response(generate(), mimetype='audio/mpeg')
    except Exception:
        return jsonify({'error': 'Error streaming file'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)