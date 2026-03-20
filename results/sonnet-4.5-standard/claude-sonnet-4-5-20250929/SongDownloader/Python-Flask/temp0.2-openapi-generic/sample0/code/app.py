from flask import Flask, request, send_file, jsonify
import os
from pathlib import Path

app = Flask(__name__)

# Define the songs directory
SONGS_DIR = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that data exists
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Get filename from request
        filename = data.get('filename')
        
        # Validate filename exists
        if not filename:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate filename is a string
        if not isinstance(filename, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Prevent directory traversal attacks by checking for path separators
        if '/' in filename or '\\' in filename or '..' in filename:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Construct the full path
        file_path = os.path.join(SONGS_DIR, filename)
        
        # Resolve the path to get the absolute path
        resolved_path = os.path.abspath(file_path)
        resolved_songs_dir = os.path.abspath(SONGS_DIR)
        
        # Ensure the resolved path is within the songs directory (prevent directory traversal)
        if not resolved_path.startswith(resolved_songs_dir + os.sep):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Check if file exists
        if not os.path.isfile(resolved_path):
            return jsonify({'error': 'File does not exist'}), 404
        
        # Stream the file
        return send_file(
            resolved_path,
            mimetype='audio/mpeg',
            as_attachment=False,
            download_name=filename
        )
    
    except Exception as e:
        # Handle any unexpected errors
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)