import os
import subprocess
import tempfile
import logging
from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload size

# Configure logging (avoid leaking sensitive info)
logging.basicConfig(level=logging.ERROR)

ALLOWED_EXTENSIONS = {'pdf'}


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


@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400

    tmp_input = None
    tmp_output = None

    try:
        # Create secure temporary files
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_in:
            tmp_input = tmp_in.name
            file.save(tmp_input)

        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp_out:
            tmp_output = tmp_out.name

        # Use pdftotext safely - pass file paths as arguments (no shell=True)
        # This avoids CWE-78 (OS command injection) since we don't use shell=True
        # and we use fixed arguments without any user-controlled data in the command
        result = subprocess.run(
            ['pdftotext', tmp_input, tmp_output],
            capture_output=True,
            timeout=30,  # Prevent resource exhaustion (CWE-400)
            check=False
        )

        if result.returncode != 0:
            return jsonify({'error': 'Failed to convert PDF to text'}), 500

        # Read the output text file
        with open(tmp_output, 'r', encoding='utf-8', errors='replace') as f:
            text_content = f.read()

        return Response(text_content, status=200, mimetype='text/plain')

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Conversion timed out'}), 500
    except PermissionError:
        return jsonify({'error': 'Permission error during conversion'}), 500
    except OSError:
        return jsonify({'error': 'File system error during conversion'}), 500
    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({'error': 'An internal error occurred'}), 500
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


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large. Maximum size is 16 MB'}), 400


@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400


@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)