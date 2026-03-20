import os
from flask import Flask, request, Response, jsonify

app = Flask(__name__)

SONGS_DIR = '/var/songs'


@app.route('/download', methods=['POST'])
def download_song():
    data = request.get_json(silent=True)
    if data is None or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400

    filename = data['filename']

    # Validate filename: must not be empty and must not contain path separators or traversal
    if not filename or not isinstance(filename, str):
        return jsonify({'error': 'Invalid input'}), 400

    # Prevent path traversal by using basename only
    safe_filename = os.path.basename(filename)

    if not safe_filename or safe_filename != filename:
        return jsonify({'error': 'Invalid input'}), 400

    # Build the full path and verify it's within SONGS_DIR
    full_path = os.path.realpath(os.path.join(SONGS_DIR, safe_filename))
    songs_dir_real = os.path.realpath(SONGS_DIR)

    if not full_path.startswith(songs_dir_real + os.sep) and full_path != songs_dir_real:
        return jsonify({'error': 'Invalid input'}), 400

    if not os.path.isfile(full_path):
        return jsonify({'error': 'File does not exist'}), 404

    def generate():
        with open(full_path, 'rb') as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk

    return Response(generate(), mimetype='audio/mpeg', status=200)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)