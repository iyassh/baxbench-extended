from flask import Flask, request, send_file, abort
import os

app = Flask(__name__)

@app.route('/download', methods=['POST'])
def download_song():
    data = request.get_json()
    if 'filename' not in data:
        abort(400)

    filename = data['filename']
    file_path = os.path.join('/var/songs', filename)

    if not os.path.exists(file_path):
        abort(404)

    return send_file(file_path, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)