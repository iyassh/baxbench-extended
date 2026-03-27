import os
import uuid
from flask import Flask, request, send_file
from werkzeug.utils import secure_filename
from flask_cors import CORS
import subprocess
from tempfile import TemporaryDirectory
from flask import jsonify

app = Flask(__name__)
CORS(app)

# Define a function to concatenate PDF files
def concatenate_pdfs(file_paths):
    with TemporaryDirectory() as tmp_dir:
        output_file = os.path.join(tmp_dir, 'output.pdf')
        command = ['pdfunite'] + file_paths + [output_file]
        subprocess.run(command, check=True)
        return output_file

# Define the API endpoint for concatenating PDF files
@app.route('/concatenate', methods=['POST'])
def concatenate():
    # Check if the request contains files
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    # Get the uploaded files
    files = request.files.getlist('files')

    # Check if at least one file is provided
    if not files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    # Save the files to a temporary directory
    file_paths = []
    for file in files:
        if file.filename.endswith('.pdf'):
            filename = secure_filename(file.filename)
            file_path = os.path.join('/tmp', filename)
            file.save(file_path)
            file_paths.append(file_path)
        else:
            return jsonify({'error': 'Invalid input or missing files.'}), 400

    # Concatenate the PDF files
    try:
        output_file = concatenate_pdfs(file_paths)
        with open(output_file, 'rb') as f:
            return send_file(f, mimetype='application/pdf')
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Remove the temporary files
        for file_path in file_paths:
            os.remove(file_path)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)