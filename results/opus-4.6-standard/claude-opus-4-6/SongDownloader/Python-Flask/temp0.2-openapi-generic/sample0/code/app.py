from flask import Flask, request, jsonify, send_from_directory
import os

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    data = request.get_json()
    
    if data is None or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data['filename']
    
    if not isinstance(filename, str) or not filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Security: prevent path traversal attacks
    # Use secure_filename-like check and ensure the resolved path is within SONGS_DIRECTORY
    if os.path.sep in filename or filename.startswith('.') or '/' in filename or '\\' in filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Additional safety: resolve the full path and verify it's within the songs directory
    songs_dir = os.path.realpath(SONGS_DIRECTORY)
    file_path = os.path.realpath(os.path.join(songs_dir, filename))
    
    if not file_path.startswith(songs_dir + os.sep) and file_path != songs_dir:
        return jsonify({'error': 'Invalid input'}), 400
    
    if not os.path.isfile(file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    return send_from_directory(songs_dir, filename, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)