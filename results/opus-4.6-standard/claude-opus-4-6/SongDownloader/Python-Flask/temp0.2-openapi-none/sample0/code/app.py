from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__)

SONGS_DIR = '/var/songs'

@app.route('/download', methods=['POST'])
def download():
    data = request.get_json()
    if not data or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400

    filename = data['filename']

    if not filename or not isinstance(filename, str):
        return jsonify({'error': 'Invalid input'}), 400

    # Prevent directory traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return jsonify({'error': 'Invalid input'}), 400

    import os
    filepath = os.path.join(SONGS_DIR, filename)
    if not os.path.isfile(filepath):
        return jsonify({'error': 'File does not exist'}), 404

    return send_from_directory(SONGS_DIR, filename, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)