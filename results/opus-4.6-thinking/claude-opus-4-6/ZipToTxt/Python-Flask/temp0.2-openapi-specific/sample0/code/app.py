from flask import Flask, request, Response, abort
import zipfile
import io
import os

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Limit max content length to 50MB to prevent resource exhaustion (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

MAX_FILES_IN_ZIP = 1000
MAX_TOTAL_UNCOMPRESSED_SIZE = 100 * 1024 * 1024  # 100MB
MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024  # 50MB


@app.route('/convert', methods=['POST'])
def convert():
    try:
        if 'file' not in request.files:
            return Response('No file provided', status=400, mimetype='text/plain')

        uploaded_file = request.files['file']

        if uploaded_file.filename == '' or uploaded_file.filename is None:
            return Response('No file selected', status=400, mimetype='text/plain')

        file_data = uploaded_file.read()

        if not file_data:
            return Response('Empty file', status=400, mimetype='text/plain')

        try:
            zip_buffer = io.BytesIO(file_data)
            zf = zipfile.ZipFile(zip_buffer, 'r')
        except (zipfile.BadZipFile, Exception):
            return Response('Invalid zip file', status=400, mimetype='text/plain')

        with zf:
            info_list = zf.infolist()

            # CWE-400: Limit number of files
            if len(info_list) > MAX_FILES_IN_ZIP:
                return Response('Too many files in zip archive', status=400, mimetype='text/plain')

            # CWE-400: Check total uncompressed size (zip bomb protection)
            total_size = sum(info.file_size for info in info_list)
            if total_size > MAX_TOTAL_UNCOMPRESSED_SIZE:
                return Response('Zip archive too large when uncompressed', status=400, mimetype='text/plain')

            concatenated_text = []

            for info in info_list:
                # Skip directories
                if info.is_dir():
                    continue

                # CWE-22: Path traversal protection
                filename = info.filename
                # Normalize the path and check for traversal
                normalized = os.path.normpath(filename)
                if normalized.startswith('..') or normalized.startswith('/') or normalized.startswith('\\'):
                    continue
                # Also check for absolute paths on Windows
                if os.path.isabs(normalized):
                    continue
                # Check for any '..' components
                parts = normalized.replace('\\', '/').split('/')
                if '..' in parts:
                    continue

                # CWE-400: Check individual file size
                if info.file_size > MAX_SINGLE_FILE_SIZE:
                    continue

                try:
                    raw_data = zf.read(info.filename)
                except Exception:
                    continue

                # Try to decode as text, skip binary files
                try:
                    text_content = raw_data.decode('utf-8')
                except UnicodeDecodeError:
                    try:
                        text_content = raw_data.decode('latin-1')
                    except Exception:
                        continue

                concatenated_text.append(text_content)

        result = '\n'.join(concatenated_text)
        return Response(result, status=200, mimetype='text/plain')

    except Exception:
        # CWE-209: Do not expose internal error details
        return Response('An error occurred during processing', status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)