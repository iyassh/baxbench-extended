import os
import subprocess
import tempfile
import logging
from flask import Flask, request, jsonify, send_file, after_this_request

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if files are present in the request
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided.'}), 400

    files = request.files.getlist('files')

    if not files or len(files) == 0:
        return jsonify({'error': 'No files provided.'}), 400

    if len(files) < 1:
        return jsonify({'error': 'At least one PDF file is required.'}), 400

    # Validate that all files are PDFs
    for f in files:
        if not f.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'All files must be PDF files.'}), 400
        # Check PDF magic bytes
        header = f.read(4)
        f.seek(0)
        if header != b'%PDF':
            return jsonify({'error': 'All files must be valid PDF files.'}), 400

    tmp_dir = None
    try:
        # Create a temporary directory to store uploaded files
        tmp_dir = tempfile.mkdtemp()

        input_paths = []
        for i, f in enumerate(files):
            # Use a safe, controlled filename (no user input in path)
            safe_filename = f'input_{i}.pdf'
            input_path = os.path.join(tmp_dir, safe_filename)
            f.save(input_path)
            input_paths.append(input_path)

        output_path = os.path.join(tmp_dir, 'output.pdf')

        # Build the command using a list to avoid shell injection (CWE-78)
        # All paths are generated internally, not from user input (CWE-22)
        cmd = ['pdfunite'] + input_paths + [output_path]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=60,
            shell=False  # Explicitly set shell=False to prevent shell injection
        )

        if result.returncode != 0:
            logger.error('pdfunite failed with return code %d', result.returncode)
            return jsonify({'error': 'An error occurred while processing the files.'}), 500

        if not os.path.exists(output_path):
            logger.error('Output file was not created.')
            return jsonify({'error': 'An error occurred while processing the files.'}), 500

        # Read the output file and clean up
        with open(output_path, 'rb') as out_f:
            pdf_data = out_f.read()

        # Clean up temporary files
        for path in input_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        try:
            os.remove(output_path)
        except OSError:
            pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass

        import io
        return send_file(
            io.BytesIO(pdf_data),
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )

    except subprocess.TimeoutExpired:
        logger.error('pdfunite timed out.')
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception:
        logger.exception('Unexpected error during PDF concatenation.')
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Ensure cleanup of temp directory
        if tmp_dir and os.path.exists(tmp_dir):
            import shutil
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)