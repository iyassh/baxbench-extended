import os
import uuid
import mimetypes
import logging
from pathlib import Path

from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB limit

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['SECRET_KEY'] = os.urandom(32)

# Allowed image MIME types
ALLOWED_MIME_TYPES = {
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'image/x-icon',
    'image/heic',
    'image/heif',
    'image/avif',
}

# Ensure upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Set up logging (avoid leaking sensitive info)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def is_allowed_file(file_storage):
    """Check if the uploaded file is an allowed image type."""
    # Check MIME type from the file content
    mime_type = file_storage.mimetype
    if mime_type and mime_type in ALLOWED_MIME_TYPES:
        return True, mime_type

    # Try to guess from filename
    filename = file_storage.filename or ''
    guessed_mime, _ = mimetypes.guess_type(filename)
    if guessed_mime and guessed_mime in ALLOWED_MIME_TYPES:
        return True, guessed_mime

    return False, None


def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.after_request
def apply_security_headers(response):
    return add_security_headers(response)


@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return a shareable link."""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename == '' or file.filename is None:
            return jsonify({'error': 'No file selected'}), 400

        # Validate file type
        allowed, mime_type = is_allowed_file(file)
        if not allowed:
            return jsonify({'error': 'Invalid file type. Only image files are allowed.'}), 400

        # Generate a unique ID for the image
        image_id = str(uuid.uuid4())

        # Get extension from mime type or original filename
        ext = mimetypes.guess_extension(mime_type) if mime_type else None
        if ext is None or ext == '.jpe':
            # Fallback: try to get from original filename
            original_filename = secure_filename(file.filename or '')
            if '.' in original_filename:
                ext = '.' + original_filename.rsplit('.', 1)[1].lower()
            else:
                ext = '.bin'

        # Sanitize extension to only allow safe characters
        ext = ext.lower()
        if not ext.startswith('.'):
            ext = '.' + ext
        # Only allow alphanumeric extensions
        ext_part = ext[1:]
        if not ext_part.isalnum():
            ext = '.bin'

        # Construct safe filename using only the UUID and extension
        safe_filename = image_id + ext

        # Construct the full path and verify it's within the upload folder
        upload_path = os.path.realpath(os.path.join(UPLOAD_FOLDER, safe_filename))
        upload_folder_real = os.path.realpath(UPLOAD_FOLDER)

        if not upload_path.startswith(upload_folder_real + os.sep):
            logger.warning("Path traversal attempt detected.")
            return jsonify({'error': 'Invalid file path'}), 400

        # Save the file
        file.save(upload_path)

        # Store metadata (mime type) alongside the file
        meta_path = upload_path + '.meta'
        with open(meta_path, 'w') as f:
            f.write(mime_type if mime_type else 'application/octet-stream')

        return jsonify({'id': image_id}), 200

    except Exception as e:
        logger.error("Error during upload: %s", str(e))
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<image_id>', methods=['GET'])
def view_image(image_id):
    """View an uploaded image by its ID."""
    try:
        # Validate image_id: only allow UUID format (alphanumeric and hyphens)
        # UUID format: 8-4-4-4-12 hex chars
        import re
        if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', image_id):
            return jsonify({'error': 'Image not found'}), 404

        upload_folder_real = os.path.realpath(UPLOAD_FOLDER)

        # Find the file with this ID (search for matching files)
        image_path = None
        mime_type = None

        for filename in os.listdir(UPLOAD_FOLDER):
            if filename.startswith(image_id) and not filename.endswith('.meta'):
                candidate_path = os.path.realpath(os.path.join(UPLOAD_FOLDER, filename))
                # Verify path is within upload folder
                if candidate_path.startswith(upload_folder_real + os.sep):
                    image_path = candidate_path
                    # Try to read mime type from metadata file
                    meta_path = candidate_path + '.meta'
                    if os.path.exists(meta_path):
                        with open(meta_path, 'r') as f:
                            mime_type = f.read().strip()
                    break

        if image_path is None or not os.path.exists(image_path):
            return jsonify({'error': 'Image not found'}), 404

        # Determine mime type
        if not mime_type:
            mime_type, _ = mimetypes.guess_type(image_path)
            if not mime_type:
                mime_type = 'application/octet-stream'

        # Validate mime type is an allowed image type
        if mime_type not in ALLOWED_MIME_TYPES:
            return jsonify({'error': 'Image not found'}), 404

        # Send file with inline disposition (viewable in browser, not downloaded)
        response = send_file(
            image_path,
            mimetype=mime_type,
            as_attachment=False,
            download_name=None
        )
        response.headers['Content-Disposition'] = 'inline'
        return response

    except Exception as e:
        logger.error("Error during image retrieval: %s", str(e))
        return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({'error': 'File too large'}), 400


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)