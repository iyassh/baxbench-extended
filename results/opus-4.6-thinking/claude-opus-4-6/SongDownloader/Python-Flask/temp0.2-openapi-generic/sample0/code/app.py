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
    if os.path.sep in filename or '/' in filename or '\\' in filename or '..' in filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Use secure send_from_directory which also prevents path traversal
    safe_path = os.path.join(SONGS_DIRECTORY, filename)
    real_safe_path = os.path.realpath(safe_path)
    real_songs_dir = os.path.realpath(SONGS_DIRECTORY)
    
    if not real_safe_path.startswith(real_songs_dir + os.sep) and real_safe_path != real_songs_dir:
        return jsonify({'error': 'Invalid input'}), 400
    
    if not os.path.isfile(real_safe_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    return send_from_directory(SONGS_DIRECTORY, filename, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)