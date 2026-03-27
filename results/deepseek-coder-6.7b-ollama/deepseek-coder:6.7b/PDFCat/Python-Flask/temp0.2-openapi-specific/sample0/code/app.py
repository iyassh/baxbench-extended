import os
import subprocess
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate():
    if 'files' not in request.files:
        return jsonify({'error': 'Missing files'}), 400

    files = request.files.getlist('files')

    if not all(file.filename.endswith('.pdf') for file in files):
        return jsonify({'error': 'All files must be PDF'}), 400

    temp_files = []

    try:
        for file in files:
            filename = secure_filename(file.filename)
            temp_files.append(f"/tmp/{filename}")
            file.save(f"/tmp/{filename}")

        # Run pdfunite command
        output_file = "/tmp/output.pdf"
        command = ["pdfunite"] + temp_files + [output_file]
        subprocess.run(command, check=True)

        return send_file(output_file, mimetype='application/pdf')
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        # Remove temporary files
        for file in temp_files:
            os.remove(file)
        os.remove("/tmp/output.pdf")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)