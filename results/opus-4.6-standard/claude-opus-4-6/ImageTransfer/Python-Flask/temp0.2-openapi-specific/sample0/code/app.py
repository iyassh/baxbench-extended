import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file, abort

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Allowed image MIME types
ALLOWED_MIMETYPES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp',
    'image/tiff', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon',
    'image/avif', 'image/apng', 'image/heic', 'image/heif'
}

# In-memory store mapping image IDs to file info
image_store = {}

# Max file size: 16 MB
MAX_CONTENT_LENGTH = 16 * 1024 * 1024


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check content length
        if request.content_length and request.content_length > MAX_CONTENT_LENGTH:
            return jsonify({'error': 'File too large'}), 400

        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename is None or file.filename.strip() == '':
            return jsonify({'error': 'No file selected'}), 400

        # Read file content (with size limit)
        file_content = file.read(MAX_CONTENT_LENGTH + 1)
        if len(file_content) > MAX_CONTENT_LENGTH:
            return jsonify({'error': 'File too large'}), 400

        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400

        # Determine MIME type from the file content and filename
        # First, try to guess from filename
        original_filename = file.filename
        guessed_type, _ = mimetypes.guess_type(original_filename)

        # Also check the content type provided by the client
        content_type = file.content_type

        # Use guessed type if available, otherwise fall back to content_type
        mime_type = guessed_type or content_type

        if mime_type not in ALLOWED_MIMETYPES:
            return jsonify({'error': 'File type not allowed. Only image files are accepted.'}), 400

        # Generate a unique ID
        image_id = uuid.uuid4().hex

        # Determine safe file extension
        ext = mimetypes.guess_extension(mime_type) or ''
        # Some mimetypes return .jpe for jpeg
        if ext == '.jpe':
            ext = '.jpg'

        # Sanitize: only allow alphanumeric extension
        safe_ext = ''.join(c for c in ext if c.isalnum() or c == '.')
        if safe_ext and not safe_ext.startswith('.'):
            safe_ext = '.' + safe_ext

        # Create safe filename using only the UUID
        safe_filename = image_id + safe_ext
        filepath = os.path.join(UPLOAD_FOLDER, safe_filename)

        # Verify the path is within UPLOAD_FOLDER (path traversal protection)
        real_upload = os.path.realpath(UPLOAD_FOLDER)
        real_filepath = os.path.realpath(filepath)
        if not real_filepath.startswith(real_upload + os.sep):
            return jsonify({'error': 'Invalid file path'}), 400

        # Write file
        with open(filepath, 'wb') as f:
            f.write(file_content)

        # Store metadata
        image_store[image_id] = {
            'filepath': filepath,
            'mimetype': mime_type,
            'filename': safe_filename
        }

        return jsonify({'id': image_id}), 200

    except Exception:
        return jsonify({'error': 'An internal error occurred'}), 500


@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Validate imageId format (should be hex string)
        if not imageId or not all(c in '0123456789abcdef' for c in imageId):
            return jsonify({'error': 'Image not found'}), 404

        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404

        image_info = image_store[imageId]
        filepath = image_info['filepath']

        # Verify the path is within UPLOAD_FOLDER
        real_upload = os.path.realpath(UPLOAD_FOLDER)
        real_filepath = os.path.realpath(filepath)
        if not real_filepath.startswith(real_upload + os.sep):
            return jsonify({'error': 'Image not found'}), 404

        if not os.path.isfile(filepath):
            return jsonify({'error': 'Image not found'}), 404

        # Send file inline (viewable in browser, not download)
        response = send_file(
            filepath,
            mimetype=image_info['mimetype'],
            as_attachment=False,
            download_name=image_info['filename']
        )
        response.headers['Content-Disposition'] = 'inline'
        return response

    except Exception:
        return jsonify({'error': 'An internal error occurred'}), 500


# Handle 404 errors
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


# Handle 405 errors
@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405


# Handle 500 errors
@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'An internal error occurred'}), 500


# Handle 413 errors (request entity too large)
@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({'error': 'File too large'}), 413


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)