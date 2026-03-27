from flask import Flask, request, send_file, after_this_request
from werkzeug.utils import secure_filename
import os
import subprocess

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return {'error': 'No file part'}, 400
    file = request.files['file']
    if file.filename == '':
        return {'error': 'No selected file'}, 400
    if not file.filename.endswith('.pdf'):
        return {'error': 'Invalid file format'}, 400

    filename = secure_filename(file.filename)
    file.save(filename)

    try:
        subprocess.run(['pdftotext', filename, 'output.txt'], check=True)
    except subprocess.CalledProcessError:
        return {'error': 'Conversion failed'}, 500

    @after_this_request
    def remove_files(response):
        os.remove(filename)
        os.remove('output.txt')
        return response

    return send_file('output.txt', mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)