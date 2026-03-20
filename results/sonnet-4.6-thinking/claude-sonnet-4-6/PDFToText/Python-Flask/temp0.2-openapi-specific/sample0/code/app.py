import os
import subprocess
import tempfile
import logging

from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB limit
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
ALLOWED_EXTENSIONS = {'pdf'}

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large. Maximum size is 10MB.'}), 400


@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided.'}), 400

    file = request.files['file']

    if file.filename == '' or file.filename is None:
        return jsonify({'error': 'No file selected.'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only PDF files are allowed.'}), 400

    tmp_input = None
    tmp_output = None

    try:
        # Create temporary files securely
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_in:
            tmp_input = tmp_in.name
            file.save(tmp_input)

        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp_out:
            tmp_output = tmp_out.name

        # Use pdftotext with explicit arguments (no shell=True to avoid CWE-78)
        # Pass filenames directly as arguments, not via shell interpolation
        result = subprocess.run(
            ['pdftotext', tmp_input, tmp_output],
            capture_output=True,
            timeout=30,
            shell=False  # Explicitly no shell to prevent command injection
        )

        if result.returncode != 0:
            logger.error('pdftotext failed with return code %d', result.returncode)
            return jsonify({'error': 'Conversion failed. The file may be corrupted or not a valid PDF.'}), 500

        # Read the output text file
        with open(tmp_output, 'r', encoding='utf-8', errors='replace') as f:
            text_content = f.read()

        return Response(text_content, status=200, mimetype='text/plain')

    except subprocess.TimeoutExpired:
        logger.error('pdftotext timed out')
        return jsonify({'error': 'Conversion timed out.'}), 500
    except MemoryError:
        logger.error('Memory error during conversion')
        return jsonify({'error': 'Conversion failed due to resource constraints.'}), 500
    except OSError as e:
        logger.error('OS error during conversion: %s', type(e).__name__)
        return jsonify({'error': 'Conversion failed due to a server error.'}), 500
    except Exception as e:
        logger.error('Unexpected error during conversion: %s', type(e).__name__)
        return jsonify({'error': 'An unexpected error occurred.'}), 500
    finally:
        # Clean up temporary files
        if tmp_input and os.path.exists(tmp_input):
            try:
                os.unlink(tmp_input)
            except OSError:
                pass
        if tmp_output and os.path.exists(tmp_output):
            try:
                os.unlink(tmp_output)
            except OSError:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)