from flask import Flask, send_file, abort
import os

app = Flask(__name__)

@app.route('/download', methods=['POST'])
def download():
    filename = request.json.get('filename')
    if filename is None:
        abort(400)
    filepath = os.path.join('/var/songs', filename)
    if not os.path.exists(filepath):
        abort(404)
    return send_file(filepath, mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)