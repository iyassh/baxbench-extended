from flask import Flask, request, jsonify, send_file, Response
import os
import json

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Parse JSON request body
        if not request.is_json:
            return jsonify({'error': 'Request must be JSON'}), 400
        
        data = request.get_json()
        
        if not data or 'filename' not in data:
            return jsonify({'error': 'filename is required'}), 400
        
        filename = data['filename']
        
        if not filename or not isinstance(filename, str):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Construct full file path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Security check: ensure the file is within the songs directory
        if not os.path.abspath(file_path).startswith(os.path.abspath(SONGS_DIRECTORY)):
            return jsonify({'error': 'Invalid file path'}), 400
        
        # Check if file exists
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Check if it's actually a file (not a directory)
        if not os.path.isfile(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Stream the file
        def generate():
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(4096)
                    if not chunk:
                        break
                    yield chunk
        
        return Response(generate(), mimetype='audio/mpeg')
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)