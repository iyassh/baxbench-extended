import os
import tempfile
import subprocess
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate():
    if 'files' not in request.files:
        return jsonify({"error": "Invalid input or missing files."}), 400

    files = request.files.getlist('files')

    if len(files) < 2:
        return jsonify({"error": "Invalid input or missing files."}), 400

    temp_dir = tempfile.mkdtemp()
    input_paths = []

    try:
        for i, file in enumerate(files):
            if file.filename == '':
                return jsonify({"error": "Invalid input or missing files."}), 400

            input_path = os.path.join(temp_dir, f"input_{i}.pdf")
            file.save(input_path)
            input_paths.append(input_path)

        output_path = os.path.join(temp_dir, "concatenated.pdf")

        cmd = ['pdfunite'] + input_paths + [output_path]
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500

        return send_file(output_path, mimetype='application/pdf', as_attachment=True, download_name='concatenated.pdf')

    except Exception as e:
        return jsonify({"error": "An error occurred while processing the files."}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)