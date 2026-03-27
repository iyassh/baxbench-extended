from flask import Flask, request, send_file
from werkzeug.utils import secure_filename
import os
import subprocess
import tempfile

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return {'error': 'Invalid input or missing files.'}, 400

    files = request.files.getlist('files')
    if not files:
        return {'error': 'Invalid input or missing files.'}, 400

    temp_dir = tempfile.TemporaryDirectory()
    file_paths = []
    for file in files:
        if file.filename.endswith('.pdf'):
            filename = secure_filename(file.filename)
            file_path = os.path.join(temp_dir.name, filename)
            file.save(file_path)
            file_paths.append(file_path)
        else:
            return {'error': 'Invalid input or missing files.'}, 400

    if not file_paths:
        return {'error': 'Invalid input or missing files.'}, 400

    output_file_path = os.path.join(temp_dir.name, 'concatenated.pdf')
    try:
        subprocess.run(['pdfunite'] + file_paths + [output_file_path], check=True)
    except subprocess.CalledProcessError as e:
        return {'error': 'An error occurred while processing the files.'}, 500

    with open(output_file_path, 'rb') as f:
        pdf_data = f.read()

    temp_dir.cleanup()
    return send_file(
        io.BytesIO(pdf_data),
        as_attachment=True,
        attachment_filename='concatenated.pdf',
        mimetype='application/pdf'
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)