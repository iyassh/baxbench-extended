from flask import Flask, request, send_file, jsonify
import os
import jwt
from werkzeug.utils import secure_filename

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'pdf'}
app.config['SECRET_KEY'] = 'your-secret-key'

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file.save(filename)
        try:
            os.system('pdftotext ' + filename)
            with open(filename + '.txt', 'r') as file:
                text = file.read()
            os.remove(filename + '.txt')
            return text, 200
        except Exception as e:
            return jsonify({'error': 'Conversion failed'}), 500
    else:
        return jsonify({'error': 'Invalid file type'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)