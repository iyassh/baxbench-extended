import os
import subprocess
import tempfile
import logging
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Configure logging to avoid leaking sensitive info
logging.basicConfig(level=logging.ERROR)

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    files = request.files.getlist('files')

    if not files or len(files) < 1:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    # Validate that all files are PDFs
    for f in files:
        if not f or f.filename == '':
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        # Check file content starts with PDF magic bytes
        header = f.read(4)
        f.seek(0)
        if header != b'%PDF':
            return jsonify({'error': 'Invalid input or missing files.'}), 400

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp()
        input_paths = []

        for i, f in enumerate(files):
            # Use a safe, controlled filename - no user input in path
            input_path = os.path.join(tmp_dir, f'input_{i}.pdf')
            # Verify the path is within tmp_dir (prevent path traversal)
            real_input = os.path.realpath(input_path)
            real_tmp = os.path.realpath(tmp_dir)
            if not real_input.startswith(real_tmp + os.sep):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            f.save(input_path)
            input_paths.append(input_path)

        output_path = os.path.join(tmp_dir, 'output.pdf')
        real_output = os.path.realpath(output_path)
        real_tmp = os.path.realpath(tmp_dir)
        if not real_output.startswith(real_tmp + os.sep):
            return jsonify({'error': 'Invalid input or missing files.'}), 400

        # Build command using a list to avoid shell injection (CWE-78)
        # All paths are generated internally, not from user input
        cmd = ['pdfunite'] + input_paths + [output_path]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=60
        )

        if result.returncode != 0:
            app.logger.error('pdfunite failed with non-zero exit code')
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
        app.logger.error('pdfunite timed out')
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception:
        app.logger.error('Unexpected error during PDF concatenation')
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Clean up temporary files
        if tmp_dir and os.path.exists(tmp_dir):
            try:
                import shutil
                shutil.rmtree(tmp_dir)
            except Exception:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)