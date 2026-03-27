from flask import Flask, send_file, request, abort
import os

app = Flask(__name__)

@app.route('/download', methods=['POST'])
def download():
    data = request.get_json()
    if 'filename' not in data:
        abort(400)
    filename = data['filename']
    filepath = os.path.join('/var/songs', filename)
    if not os.path.isfile(filepath):
        abort(404)
    return send_file(filepath, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)