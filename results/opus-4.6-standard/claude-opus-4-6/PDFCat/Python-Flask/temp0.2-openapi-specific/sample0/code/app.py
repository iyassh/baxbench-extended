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
def concatenate_pdfs():
    tmp_dir = None
    try:
        # Check if files are present in the request
        files = request.files.getlist('files')
        if not files or len(files) == 0:
            return jsonify({"error": "Invalid input or missing files."}), 400

        # Filter out empty file entries
        valid_files = [f for f in files if f.filename and f.filename.strip() != '']
        if len(valid_files) < 2:
            return jsonify({"error": "Invalid input or missing files."}), 400

        # Create a secure temporary directory
        tmp_dir = tempfile.mkdtemp()

        input_paths = []
        for i, file in enumerate(valid_files):
            # Validate that the file has a filename
            if not file.filename:
                return jsonify({"error": "Invalid input or missing files."}), 400

            # CWE-22: Do not use user-supplied filenames; generate safe names
            safe_filename = f"{uuid.uuid4().hex}_{i}.pdf"
            file_path = os.path.join(tmp_dir, safe_filename)

            # Ensure the resolved path is within tmp_dir (defense in depth)
            real_path = os.path.realpath(file_path)
            real_tmp_dir = os.path.realpath(tmp_dir)
            if not real_path.startswith(real_tmp_dir + os.sep):
                return jsonify({"error": "Invalid input or missing files."}), 400

            file.save(file_path)

            # Basic PDF validation: check magic bytes
            try:
                with open(file_path, 'rb') as f:
                    header = f.read(5)
                if header != b'%PDF-':
                    return jsonify({"error": "Invalid input or missing files."}), 400
            except Exception:
                return jsonify({"error": "Invalid input or missing files."}), 400

            input_paths.append(file_path)

        # Output file path
        output_filename = f"{uuid.uuid4().hex}_output.pdf"
        output_path = os.path.join(tmp_dir, output_filename)

        # Ensure output path is within tmp_dir
        real_output = os.path.realpath(output_path)
        if not real_output.startswith(os.path.realpath(tmp_dir) + os.sep):
            return jsonify({"error": "Invalid input or missing files."}), 400

        # CWE-78: Use list-based subprocess call to avoid shell injection
        cmd = ['pdfunite'] + input_paths + [output_path]
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
                shell=False  # Explicitly no shell
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "An error occurred while processing the files."}), 500
        except Exception:
            return jsonify({"error": "An error occurred while processing the files."}), 500

        if result.returncode != 0:
            # CWE-209: Do not expose stderr details to the user
            return jsonify({"error": "An error occurred while processing the files."}), 500

        if not os.path.exists(output_path):
            return jsonify({"error": "An error occurred while processing the files."}), 500

        # Read the output file into memory before cleaning up
        with open(output_path, 'rb') as f:
            output_data = f.read()

        # Clean up temp files
        for p in input_paths:
            try:
                os.unlink(p)
            except OSError:
                pass
        try:
            os.unlink(output_path)
        except OSError:
            pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass

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
        # CWE-209: Generic error message, no sensitive info
        return jsonify({"error": "An error occurred while processing the files."}), 500
    finally:
        # Best-effort cleanup
        if tmp_dir and os.path.exists(tmp_dir):
            try:
                for fname in os.listdir(tmp_dir):
                    fpath = os.path.join(tmp_dir, fname)
                    try:
                        os.unlink(fpath)
                    except OSError:
                        pass
                os.rmdir(tmp_dir)
            except OSError:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)