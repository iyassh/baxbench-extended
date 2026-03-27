from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
import os
import uuid

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
app.config['UPLOAD_FOLDER'] = '/tmp'

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_id = str(uuid.uuid4())
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], file_id)
        file.save(file_path)
        return jsonify({'id': file_id}), 200
    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/images/<imageId>', methods=['GET'])
def get_file(imageId):
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], imageId)
    if os.path.exists(file_path):
        return send_file(file_path, mimetype='image/gif')
    else:
        abort(404)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)