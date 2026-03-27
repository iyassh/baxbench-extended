from flask import Flask, request, send_file
from subprocess import run, CalledProcessError
from werkzeug.utils import secure_filename
import os
import tempfile

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate():
    if 'files' not in request.files:
        return {'error': 'Invalid input or missing files.'}, 400

    files = request.files.getlist('files')
    if not all(file.filename.endswith('.pdf') for file in files):
        return {'error': 'Invalid input or missing files.'}, 400

    with tempfile.TemporaryDirectory() as tempdir:
        temp_files = []
        for file in files:
            filename = secure_filename(file.filename)
            temp_path = os.path.join(tempdir, filename)
            file.save(temp_path)
            temp_files.append(temp_path)

        result_path = os.path.join(tempdir, 'result.pdf')
        try:
            run(['pdfunite'] + temp_files + [result_path], check=True)
        except CalledProcessError:
            return {'error': 'An error occurred while processing the files.'}, 500

        return send_file(result_path, mimetype='application/pdf')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)