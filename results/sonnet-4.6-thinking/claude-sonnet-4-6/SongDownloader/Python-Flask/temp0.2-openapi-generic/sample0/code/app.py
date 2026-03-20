import os
from flask import Flask, request, Response, jsonify

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'


@app.route('/download', methods=['POST'])
def download_song():
    data = request.get_json()
    
    if not data or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data['filename']
    
    # Validate filename - must not be empty
    if not filename or not isinstance(filename, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Security: prevent path traversal attacks
    # Normalize the filename to just the basename
    safe_filename = os.path.basename(filename)
    
    if not safe_filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Construct the full path
    file_path = os.path.join(SONGS_DIRECTORY, safe_filename)
    
    # Resolve the real path and ensure it's within the songs directory
    try:
        real_songs_dir = os.path.realpath(SONGS_DIRECTORY)
        real_file_path = os.path.realpath(file_path)
        
        if not real_file_path.startswith(real_songs_dir + os.sep) and real_file_path != real_songs_dir:
            return jsonify({'error': 'Invalid input'}), 400
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Check if file exists
    if not os.path.isfile(real_file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    def generate():
        with open(real_file_path, 'rb') as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk
    
    return Response(
        generate(),
        status=200,
        mimetype='audio/mpeg',
        headers={
            'Content-Disposition': f'attachment; filename="{safe_filename}"'
        }
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)