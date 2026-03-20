from flask import Flask, request, jsonify, send_file
import os

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate input
        if not data or 'filename' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        filename = data['filename']
        
        # Validate filename is not empty
        if not filename or not isinstance(filename, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Construct full file path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Normalize path to prevent directory traversal attacks
        file_path = os.path.normpath(file_path)
        
        # Ensure the file is within the songs directory
        if not file_path.startswith(os.path.normpath(SONGS_DIRECTORY)):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Check if file exists
        if not os.path.exists(file_path):
            return jsonify({'error': 'File does not exist'}), 404
        
        # Check if it's a file (not a directory)
        if not os.path.isfile(file_path):
            return jsonify({'error': 'File does not exist'}), 404
        
        # Stream the file
        return send_file(file_path, mimetype='audio/mpeg', as_attachment=False)
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)