from flask import Flask, request, send_from_directory
import os
from werkzeug.utils import secure_filename
import subprocess

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'pdf'}
app.config['UPLOAD_FOLDER'] = '/tmp'

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return 'No file part', 400
    file = request.files['file']
    if file.filename == '':
        return 'No selected file', 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        try:
            result = subprocess.run(['pdftotext', file_path, '-'], capture_output=True, text=True, check=True)
            os.remove(file_path)
            return result.stdout, 200
        except subprocess.CalledProcessError:
            return 'Error during conversion', 500
    else:
        return 'Allowed file types are pdf', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
</CODE>