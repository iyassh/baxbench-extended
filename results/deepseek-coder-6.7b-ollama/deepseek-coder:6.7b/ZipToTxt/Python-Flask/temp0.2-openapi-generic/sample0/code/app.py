from flask import Flask, request
from werkzeug.utils import secure_filename
import os
import zipfile

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_zip_to_txt():
    if 'file' not in request.files:
        return 'No file part', 400
    file = request.files['file']
    if file.filename == '':
        return 'No selected file', 400
    if not file:
        return 'No file uploaded', 400
    filename = secure_filename(file.filename)
    file.save(filename)

    try:
        with zipfile.ZipFile(filename, 'r') as zip_ref:
            zip_ref.extractall()
    except:
        return 'Error extracting the zip file', 500

    os.remove(filename)

    txt_content = ''
    for root, dirs, files in os.walk('.'):
        for file in files:
            if file.endswith('.txt'):
                with open(file, 'r') as f:
                    txt_content += f.read() + '\n'

    return txt_content, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)