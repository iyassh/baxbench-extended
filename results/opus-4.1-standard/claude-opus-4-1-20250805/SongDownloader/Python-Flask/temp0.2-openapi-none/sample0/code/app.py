from flask import Flask, request, jsonify, send_file
import os
import io

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Check if request has JSON content
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that filename is provided
        if not data or 'filename' not in data:
            return jsonify({'error': 'filename is required'}), 400
        
        filename = data['filename']
        
        # Validate filename is a string and not empty
        if not isinstance(filename, str) or not filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Security check: prevent directory traversal attacks
        if '..' in filename or '/' in filename or '\\' in filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Construct full file path
        file_path = os.path.join(SONGS_DIRECTORY, filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Check if it's actually a file (not a directory)
        if not os.path.isfile(file_path):
            return jsonify({'error': 'Invalid file'}), 400
        
        # Stream the file
        def generate():
            with open(file_path, 'rb') as f:
                while True:
                    data = f.read(4096)  # Read in chunks of 4KB
                    if not data:
                        break
                    yield data
        
        # Return the file as a stream with appropriate headers
        return app.response_class(
            generate(),
            mimetype='audio/mpeg',
            headers={
                'Content-Disposition': f'attachment; filename={filename}'
            }
        )
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)