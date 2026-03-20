import io
import zipfile
import logging
from flask import Flask, request, Response

app = Flask(__name__)

# Configure logging to avoid leaking sensitive info
logging.basicConfig(level=logging.ERROR)

# Limits
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB max upload size
MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024  # 200 MB max uncompressed size
MAX_FILES_IN_ZIP = 1000  # Max number of files in zip


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is present
    if 'file' not in request.files:
        return Response("No file provided.", status=400, mimetype='text/plain')

    uploaded_file = request.files['file']

    if uploaded_file.filename == '':
        return Response("No file selected.", status=400, mimetype='text/plain')

    # Read file content with size limit
    try:
        file_data = uploaded_file.read(MAX_FILE_SIZE + 1)
        if len(file_data) > MAX_FILE_SIZE:
            return Response("File too large.", status=400, mimetype='text/plain')
    except Exception:
        return Response("Failed to read uploaded file.", status=400, mimetype='text/plain')

    # Validate it's a zip file
    if not zipfile.is_zipfile(io.BytesIO(file_data)):
        return Response("Uploaded file is not a valid zip file.", status=400, mimetype='text/plain')

    # Process zip file
    try:
        result_parts = []
        total_uncompressed = 0

        with zipfile.ZipFile(io.BytesIO(file_data), 'r') as zf:
            members = zf.infolist()

            if len(members) > MAX_FILES_IN_ZIP:
                return Response("Zip file contains too many files.", status=400, mimetype='text/plain')

            for info in members:
                # Skip directories
                if info.filename.endswith('/') or info.is_dir():
                    continue

                # Check for path traversal (CWE-22)
                # Normalize the filename and ensure it doesn't escape
                filename = info.filename
                # Check for suspicious path components
                parts = filename.replace('\\', '/').split('/')
                safe_parts = []
                for part in parts:
                    if part in ('', '.', '..'):
                        continue
                    safe_parts.append(part)

                if not safe_parts:
                    continue

                # Check uncompressed size limit (CWE-400 - zip bomb protection)
                total_uncompressed += info.file_size
                if total_uncompressed > MAX_UNCOMPRESSED_SIZE:
                    return Response("Uncompressed content too large.", status=400, mimetype='text/plain')

                # Only process text files (try to decode as UTF-8)
                try:
                    raw_content = zf.read(info.filename)
                    # Attempt to decode as text
                    text_content = raw_content.decode('utf-8')
                    result_parts.append(text_content)
                except UnicodeDecodeError:
                    # Skip binary files
                    continue
                except Exception:
                    # Skip files that can't be read
                    continue

        combined_text = '\n'.join(result_parts)
        return Response(combined_text, status=200, mimetype='text/plain')

    except zipfile.BadZipFile:
        return Response("Invalid or corrupted zip file.", status=400, mimetype='text/plain')
    except Exception:
        return Response("An error occurred during processing.", status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)