from flask import Flask, request, send_file, jsonify
import os

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    # Check if request has JSON
    if not request.is_json:
        return jsonify({'error': 'Invalid input'}), 400
    
    data = request.get_json()
    
    # Check if filename is provided
    if 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data['filename']
    
    # Validate filename
    if not filename or not isinstance(filename, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Construct full path
    file_path = os.path.abspath(os.path.join(SONGS_DIRECTORY, filename))
    base_path = os.path.abspath(SONGS_DIRECTORY)
    
    # Security check: ensure the resolved path is within SONGS_DIRECTORY
    if not file_path.startswith(base_path + os.sep):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Check if file exists and is a file
    if not os.path.isfile(file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    # Stream the file
    return send_file(file_path, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)