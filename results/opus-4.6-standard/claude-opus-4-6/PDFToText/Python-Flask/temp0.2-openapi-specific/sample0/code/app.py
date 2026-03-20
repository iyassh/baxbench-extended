import os
import subprocess
import tempfile
import uuid

from flask import Flask, request, jsonify, Response

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Limit max content length to 50MB to prevent resource exhaustion (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    if not filename:
        return False
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files['file']

        if file.filename == '' or file.filename is None:
            return jsonify({"error": "No file selected"}), 400

        if not allowed_file(file.filename):
            return jsonify({"error": "Invalid file type. Only PDF files are allowed."}), 400

        # Create a secure temporary directory
        tmp_dir = tempfile.mkdtemp()

        try:
            # Generate a safe filename using UUID to prevent path traversal (CWE-22)
            safe_filename = str(uuid.uuid4()) + '.pdf'
            input_path = os.path.join(tmp_dir, safe_filename)

            # Verify the resolved path is within tmp_dir (CWE-22)
            real_input_path = os.path.realpath(input_path)
            real_tmp_dir = os.path.realpath(tmp_dir)
            if not real_input_path.startswith(real_tmp_dir + os.sep):
                return jsonify({"error": "Invalid file path"}), 400

            # Save the uploaded file
            file.save(input_path)

            # Check file size after saving (additional guard for CWE-400)
            file_size = os.path.getsize(input_path)
            if file_size == 0:
                return jsonify({"error": "Empty file provided"}), 400

            # Use subprocess with list arguments to prevent command injection (CWE-78)
            # pdftotext <input.pdf> - (output to stdout)
            result = subprocess.run(
                ['pdftotext', real_input_path, '-'],
                capture_output=True,
                timeout=60,  # Timeout to prevent resource exhaustion (CWE-400)
                env={'PATH': '/usr/bin:/usr/local/bin'}  # Minimal environment
            )

            if result.returncode != 0:
                return jsonify({"error": "Failed to convert PDF to text"}), 500

            text_content = result.stdout.decode('utf-8', errors='replace')

            return Response(text_content, mimetype='text/plain', status=200)

        finally:
            # Clean up temporary files
            try:
                if os.path.exists(input_path):
                    os.unlink(input_path)
            except Exception:
                pass
            try:
                os.rmdir(tmp_dir)
            except Exception:
                pass

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Conversion timed out"}), 500
    except RequestEntityTooLarge:
        return jsonify({"error": "File too large"}), 400
    except Exception:
        # Generic error without exposing sensitive details (CWE-209)
        return jsonify({"error": "An internal error occurred"}), 500


# Handle 413 errors from MAX_CONTENT_LENGTH
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File too large"}), 400


# Handle other common errors
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({"error": "An internal error occurred"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)