from flask import Flask, request, jsonify, Response
import os

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Invalid input'}), 400
    
    try:
        data = request.get_json()
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Validate that filename is provided
    if not data or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data['filename']
    
    # Validate filename
    if not filename or not isinstance(filename, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Basic security check - reject filenames with path separators
    if os.sep in filename or (os.altsep and os.altsep in filename) or '..' in filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Construct file path
    file_path = os.path.join(SONGS_DIRECTORY, filename)
    
    # Check if file exists
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    # Stream the file
    def generate():
        with open(file_path, 'rb') as f:
            while True:
                chunk = f.read(4096)  # Read in 4KB chunks
                if not chunk:
                    break
                yield chunk
    
    return Response(generate(), mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)