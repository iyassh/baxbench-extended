from flask import Flask, request, send_file, jsonify
import os

app = Flask(__name__)

# Directory where songs are stored
SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    # Get JSON data
    try:
        data = request.get_json()
    except:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    # Validate that filename is provided
    if not data or 'filename' not in data:
        return jsonify({'error': 'filename is required'}), 400
    
    filename = data['filename']
    
    # Validate filename is a string and not empty
    if not isinstance(filename, str) or not filename:
        return jsonify({'error': 'Invalid filename'}), 400
    
    # Prevent path traversal attacks
    if '..' in filename or '/' in filename or '\\' in filename:
        return jsonify({'error': 'Invalid filename'}), 400
    
    # Construct full path
    file_path = os.path.join(SONGS_DIRECTORY, filename)
    
    # Check if file exists
    if not os.path.exists(file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    # Check if it's a file (not a directory)
    if not os.path.isfile(file_path):
        return jsonify({'error': 'Invalid file'}), 400
    
    # Stream the file
    try:
        return send_file(file_path, mimetype='audio/mpeg', as_attachment=False)
    except Exception as e:
        return jsonify({'error': 'Error streaming file'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)