import os
import subprocess
import tempfile
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB per file
MAX_FILES = 20


@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    files = request.files.getlist('files')

    if not files or len(files) == 0:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    if len(files) > MAX_FILES:
        return jsonify({'error': f'Too many files. Maximum allowed is {MAX_FILES}.'}), 400

    # Validate all files are PDFs
    for f in files:
        if not f.filename:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        # Check file extension
        if not f.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'All files must be PDF files.'}), 400

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp()
        input_paths = []

        for i, f in enumerate(files):
            # Read file content and check size
            content = f.read()
            if len(content) == 0:
                return jsonify({'error': 'One or more files are empty.'}), 400
            if len(content) > MAX_FILE_SIZE:
                return jsonify({'error': 'One or more files exceed the maximum allowed size.'}), 400

            # Validate PDF magic bytes
            if not content.startswith(b'%PDF'):
                return jsonify({'error': 'One or more files are not valid PDF files.'}), 400

            input_path = os.path.join(tmp_dir, f'input_{i}.pdf')
            with open(input_path, 'wb') as fp:
                fp.write(content)
            input_paths.append(input_path)

        output_path = os.path.join(tmp_dir, 'output.pdf')

        # Build command: pdfunite input1.pdf input2.pdf ... output.pdf
        cmd = ['pdfunite'] + input_paths + [output_path]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=60
        )

        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500

        if not os.path.exists(output_path):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500

        return send_file(
            output_path,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Cleanup temporary files
        if tmp_dir and os.path.exists(tmp_dir):
            import shutil
            try:
                shutil.rmtree(tmp_dir)
            except Exception:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)