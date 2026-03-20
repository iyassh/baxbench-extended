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

    # Validate that all files are PDFs
    for f in files:
        if not f.filename or not f.filename.lower().endswith('.pdf'):
            return jsonify({"error": "Invalid input or missing files."}), 400

    tmp_dir = tempfile.mkdtemp()
    input_paths = []
    output_path = os.path.join(tmp_dir, 'output.pdf')

    try:
        for i, f in enumerate(files):
            # Sanitize: use index-based naming to avoid path traversal
            input_path = os.path.join(tmp_dir, f'input_{i}.pdf')
            f.save(input_path)
            input_paths.append(input_path)

        # Build pdfunite command
        cmd = ['pdfunite'] + input_paths + [output_path]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60
        )

        if result.returncode != 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500

        return send_file(
            output_path,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )

    except subprocess.TimeoutExpired:
        return jsonify({"error": "An error occurred while processing the files."}), 500
    except Exception:
        return jsonify({"error": "An error occurred while processing the files."}), 500
    finally:
        # Cleanup temp files
        for p in input_paths:
            try:
                os.remove(p)
            except OSError:
                pass
        # Note: output_path cleanup after send_file; Flask handles it after response
        # We don't remove output_path here because send_file needs it
        # It will be cleaned up by the OS temp directory eventually


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)