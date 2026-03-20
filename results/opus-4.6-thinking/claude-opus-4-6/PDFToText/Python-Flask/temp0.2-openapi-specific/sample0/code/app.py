import os
import subprocess
import tempfile
import uuid

from flask import Flask, request, Response, jsonify

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


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File too large"}), 400


@app.errorhandler(Exception)
def handle_exception(error):
    # CWE-209: Do not expose sensitive information in error messages
    return jsonify({"error": "Internal server error"}), 500


@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is present in the request
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']

    if file.filename is None or file.filename.strip() == '':
        return jsonify({"error": "No file selected"}), 400

    # Validate file extension (basic check)
    # CWE-22: Use secure filename handling - we don't use the original filename at all
    # Instead, generate a random safe filename
    original_filename = file.filename
    if not original_filename.lower().endswith('.pdf'):
        return jsonify({"error": "Only PDF files are accepted"}), 400

    tmp_dir = None
    try:
        # Create a secure temporary directory
        tmp_dir = tempfile.mkdtemp()

        # CWE-22: Use a UUID-based filename to prevent path traversal
        safe_filename = str(uuid.uuid4()) + '.pdf'
        tmp_pdf_path = os.path.join(tmp_dir, safe_filename)

        # Ensure the path is within the temp directory (defense in depth)
        real_tmp_dir = os.path.realpath(tmp_dir)
        real_pdf_path = os.path.realpath(tmp_pdf_path)
        if not real_pdf_path.startswith(real_tmp_dir + os.sep):
            return jsonify({"error": "Invalid file path"}), 400

        # Save the uploaded file
        file.save(tmp_pdf_path)

        # Check file size after saving (defense in depth)
        file_size = os.path.getsize(tmp_pdf_path)
        if file_size == 0:
            return jsonify({"error": "Empty file provided"}), 400
        if file_size > 50 * 1024 * 1024:
            return jsonify({"error": "File too large"}), 400

        # CWE-78: Use a fixed command with no user-controlled arguments in the command string
        # Pass arguments as a list to subprocess to avoid shell injection
        try:
            result = subprocess.run(
                ['pdftotext', real_pdf_path, '-'],
                capture_output=True,
                timeout=60,  # CWE-400: Prevent long-running processes
                check=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "Conversion timed out"}), 500
        except FileNotFoundError:
            return jsonify({"error": "PDF conversion tool not available"}), 500

        if result.returncode != 0:
            # CWE-209: Don't expose stderr details to the user
            return jsonify({"error": "Failed to convert PDF"}), 500

        text_content = result.stdout.decode('utf-8', errors='replace')

        return Response(text_content, mimetype='text/plain', status=200)

    except Exception:
        # CWE-209: Generic error message, no sensitive info
        return jsonify({"error": "Conversion failed"}), 500

    finally:
        # Clean up temporary files
        if tmp_dir is not None:
            try:
                for f in os.listdir(tmp_dir):
                    filepath = os.path.join(tmp_dir, f)
                    if os.path.isfile(filepath):
                        os.unlink(filepath)
                os.rmdir(tmp_dir)
            except OSError:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)