import os
import tempfile
import subprocess
import uuid
from flask import Flask, request, send_file, jsonify

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


@app.route('/concatenate', methods=['POST'])
def concatenate():
    tmp_dir = None
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({"error": "Invalid input or missing files."}), 400

        files = request.files.getlist('files')

        if not files or len(files) < 1:
            return jsonify({"error": "Invalid input or missing files."}), 400

        # Filter out empty file entries
        valid_files = [f for f in files if f.filename and f.filename.strip() != '']
        if len(valid_files) < 1:
            return jsonify({"error": "Invalid input or missing files."}), 400

        # Create a secure temporary directory
        tmp_dir = tempfile.mkdtemp()

        input_paths = []
        for i, file in enumerate(valid_files):
            # Validate that the file has a filename
            if not file.filename:
                return jsonify({"error": "Invalid input or missing files."}), 400

            # Use a safe generated filename to prevent path traversal (CWE-22)
            safe_filename = f"{uuid.uuid4().hex}_{i}.pdf"
            file_path = os.path.join(tmp_dir, safe_filename)

            # Ensure the resolved path is within tmp_dir (CWE-22)
            real_path = os.path.realpath(file_path)
            real_tmp_dir = os.path.realpath(tmp_dir)
            if not real_path.startswith(real_tmp_dir + os.sep):
                return jsonify({"error": "Invalid input or missing files."}), 400

            file.save(file_path)

            # Verify the file exists and is not empty
            if not os.path.isfile(file_path) or os.path.getsize(file_path) == 0:
                return jsonify({"error": "Invalid input or missing files."}), 400

            input_paths.append(file_path)

        # Generate output path
        output_filename = f"{uuid.uuid4().hex}_output.pdf"
        output_path = os.path.join(tmp_dir, output_filename)

        # Use subprocess with a list of arguments to prevent command injection (CWE-78)
        cmd = ['pdfunite'] + input_paths + [output_path]

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "An error occurred while processing the files."}), 500
        except Exception:
            return jsonify({"error": "An error occurred while processing the files."}), 500

        if result.returncode != 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500

        if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500

        # Read the output file into memory so we can clean up temp files
        with open(output_path, 'rb') as f:
            output_data = f.read()

        # Clean up temporary files
        _cleanup_tmp_dir(tmp_dir)
        tmp_dir = None

        # Return the concatenated PDF
        from io import BytesIO
        output_buffer = BytesIO(output_data)
        return send_file(
            output_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )

    except Exception:
        # Generic error to avoid leaking sensitive info (CWE-209)
        return jsonify({"error": "An error occurred while processing the files."}), 500
    finally:
        # Ensure cleanup happens even on error (CWE-703)
        if tmp_dir and os.path.isdir(tmp_dir):
            _cleanup_tmp_dir(tmp_dir)


def _cleanup_tmp_dir(tmp_dir):
    """Safely clean up a temporary directory and its contents."""
    try:
        if tmp_dir and os.path.isdir(tmp_dir):
            for filename in os.listdir(tmp_dir):
                filepath = os.path.join(tmp_dir, filename)
                try:
                    if os.path.isfile(filepath):
                        os.unlink(filepath)
                except OSError:
                    pass
            os.rmdir(tmp_dir)
    except OSError:
        pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)