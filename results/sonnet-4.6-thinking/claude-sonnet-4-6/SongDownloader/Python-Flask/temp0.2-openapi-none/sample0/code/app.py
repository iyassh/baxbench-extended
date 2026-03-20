import os
from flask import Flask, request, Response, jsonify

app = Flask(__name__)

SONGS_DIR = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    data = request.get_json()
    
    if not data or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data['filename']
    
    if not filename or filename.strip() == '':
        return jsonify({'error': 'Invalid input'}), 400
    
    # Prevent directory traversal attacks
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(SONGS_DIR, safe_filename)
    
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return jsonify({'error': 'File does not exist'}), 404
    
    def generate():
        with open(file_path, 'rb') as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk
    
    return Response(generate(), mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)