from flask import Flask, request, send_from_directory, abort
from werkzeug.utils import secure_filename
import os
import uuid

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads/'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return {"error": "No file part"}, 400
    file = request.files['file']
    if file.filename == '':
        return {"error": "No selected file"}, 400
    if file:
        filename = secure_filename(file.filename)
        file_id = str(uuid.uuid4())
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], file_id)
        file.save(file_path)
        return {'id': file_id}, 200

@app.route('/images/<imageId>', methods=['GET'])
def get_file(imageId):
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], imageId)
    if os.path.exists(file_path):
        return send_from_directory(app.config['UPLOAD_FOLDER'], imageId)
    else:
        return {"error": "Image not found"}, 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)