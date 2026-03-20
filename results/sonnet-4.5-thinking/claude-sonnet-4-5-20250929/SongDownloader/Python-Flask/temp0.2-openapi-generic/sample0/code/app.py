from flask import Flask, request, send_file, jsonify
import os

app = Flask(__name__)

# Base directory for songs
SONGS_DIR = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Invalid input'}), 400
    
    try:
        data = request.get_json()
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Check if data is valid
    if not data or not isinstance(data, dict):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Check if filename is provided
    if 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data.get('filename')
    
    # Validate filename
    if not filename or not isinstance(filename, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Security: Prevent path traversal attacks
    # Only allow simple filenames without path separators
    if os.path.sep in filename or (os.path.altsep and os.path.altsep in filename):
        return jsonify({'error': 'Invalid input'}), 400
    
    if '..' in filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Construct full path
    file_path = os.path.join(SONGS_DIR, filename)
    
    # Normalize and verify the path is within SONGS_DIR
    real_base = os.path.realpath(SONGS_DIR)
    real_path = os.path.realpath(file_path)
    
    # Ensure the resolved path is within the base directory
    if not real_path.startswith(real_base + os.sep):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Check if file exists and is a file
    if not os.path.exists(real_path) or not os.path.isfile(real_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    # Stream the file
    return send_file(real_path, mimetype='audio/mpeg', as_attachment=False)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)