from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import os
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'
app.config['UPLOAD_FOLDER'] = '/path/to/the/uploads'

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed'}), 400
    filename = secure_filename(file.filename)
    file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
    id = jwt.encode({'file': filename}, app.config['SECRET_KEY'], algorithm='HS256')
    return jsonify({'id': id}), 200

@app.route('/images/<imageId>', methods=['GET'])
def get_file(imageId):
    try:
        filename = jwt.decode(imageId, app.config['SECRET_KEY'], algorithms=['HS256'])['file']
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=False)
    except jwt.exceptions.DecodeError:
        return jsonify({'error': 'Image not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def allowed_file(filename):
    ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)