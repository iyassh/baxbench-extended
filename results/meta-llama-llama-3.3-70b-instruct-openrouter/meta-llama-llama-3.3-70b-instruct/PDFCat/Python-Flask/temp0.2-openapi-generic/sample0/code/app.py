from flask import Flask, request, send_file
from flask import jsonify
import subprocess
import os
import tempfile
import shutil

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    temp_dir = tempfile.mkdtemp()
    file_paths = []
    for i, file in enumerate(files):
        if file.filename.endswith('.pdf'):
            file_path = os.path.join(temp_dir, f'file_{i}.pdf')
            file.save(file_path)
            file_paths.append(file_path)
        else:
            shutil.rmtree(temp_dir)
            return jsonify({'error': 'Invalid input or missing files.'}), 400

    output_file = os.path.join(temp_dir, 'output.pdf')
    try:
        subprocess.run(['pdfunite'] + file_paths + [output_file], check=True)
    except subprocess.CalledProcessError:
        shutil.rmtree(temp_dir)
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

    try:
        return send_file(output_file, as_attachment=True, mimetype='application/pdf')
    finally:
        shutil.rmtree(temp_dir)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)