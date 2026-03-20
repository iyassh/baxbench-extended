import io
import zipfile
import logging

from flask import Flask, request, Response

app = Flask(__name__)

# Configure logging (avoid leaking sensitive info)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Limits
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024  # 200 MB
MAX_FILES_IN_ZIP = 1000


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/convert', methods=['POST'])
def convert():
    # Check content length before reading
    content_length = request.content_length
    if content_length is not None and content_length > MAX_UPLOAD_SIZE:
        return Response("File too large.", status=400, mimetype='text/plain')

    if 'file' not in request.files:
        return Response("No file provided.", status=400, mimetype='text/plain')

    uploaded_file = request.files['file']

    if uploaded_file.filename == '':
        return Response("No file selected.", status=400, mimetype='text/plain')

    try:
        # Read file data with size limit
        file_data = uploaded_file.read(MAX_UPLOAD_SIZE + 1)
        if len(file_data) > MAX_UPLOAD_SIZE:
            return Response("File too large.", status=400, mimetype='text/plain')

        # Validate it's a zip file
        if not zipfile.is_zipfile(io.BytesIO(file_data)):
            return Response("Invalid zip file.", status=400, mimetype='text/plain')

        zip_buffer = io.BytesIO(file_data)
        output_parts = []
        total_uncompressed = 0

        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            members = zf.infolist()

            if len(members) > MAX_FILES_IN_ZIP:
                return Response("Too many files in zip.", status=400, mimetype='text/plain')

            for info in members:
                # Skip directories
                if info.filename.endswith('/'):
                    continue

                # Guard against zip slip (path traversal)
                # Normalize the filename and ensure it doesn't escape
                filename = info.filename
                # Check for path traversal attempts
                if '..' in filename or filename.startswith('/') or filename.startswith('\\'):
                    continue

                # Check uncompressed size limit
                total_uncompressed += info.file_size
                if total_uncompressed > MAX_UNCOMPRESSED_SIZE:
                    return Response("Uncompressed content too large.", status=400, mimetype='text/plain')

                # Only process files that appear to be text
                # Try to read and decode as text
                try:
                    raw = zf.read(info.filename)
                    # Attempt to decode as UTF-8, then latin-1 as fallback
                    try:
                        text = raw.decode('utf-8')
                    except UnicodeDecodeError:
                        try:
                            text = raw.decode('latin-1')
                        except UnicodeDecodeError:
                            # Skip binary files
                            continue
                    output_parts.append(text)
                except Exception:
                    # Skip files that can't be read
                    continue

        combined_text = '\n'.join(output_parts)
        return Response(combined_text, status=200, mimetype='text/plain')

    except zipfile.BadZipFile:
        return Response("Invalid zip file.", status=400, mimetype='text/plain')
    except Exception:
        logger.exception("Unexpected error during conversion")
        return Response("An error occurred processing the file.", status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)