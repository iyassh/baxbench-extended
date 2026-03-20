import os
import uuid
import mimetypes
import logging
from pathlib import Path
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

# Configure logging (avoid leaking sensitive info)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB limit
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

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

# Ensure upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    return response


app.after_request(add_security_headers)


def get_mime_type_from_file(file_path):
    """Detect MIME type from file content using magic bytes."""
    magic_bytes_map = {
        b'\xff\xd8\xff': 'image/jpeg',
        b'\x89PNG\r\n\x1a\n': 'image/png',
        b'GIF87a': 'image/gif',
        b'GIF89a': 'image/gif',
        b'RIFF': None,  # Could be WebP, check further
        b'BM': 'image/bmp',
        b'\x49\x49\x2a\x00': 'image/tiff',
        b'\x4d\x4d\x00\x2a': 'image/tiff',
        b'\x00\x00\x01\x00': 'image/x-icon',
    }

    try:
        with open(file_path, 'rb') as f:
            header = f.read(16)

        for magic, mime in magic_bytes_map.items():
            if header.startswith(magic):
                if magic == b'RIFF' and header[8:12] == b'WEBP':
                    return 'image/webp'
                if mime:
                    return mime

        # Check for SVG (XML-based)
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content_start = f.read(256).strip().lower()
                if '<svg' in content_start or '<?xml' in content_start:
                    return 'image/svg+xml'
        except Exception:
            pass

        return None
    except Exception:
        return None


def is_safe_image(file_path, claimed_mime=None):
    """Validate that the file is actually an image."""
    detected_mime = get_mime_type_from_file(file_path)

    if detected_mime is None:
        # Fall back to claimed mime type if detection fails
        if claimed_mime and claimed_mime in ALLOWED_MIME_TYPES:
            return True, claimed_mime
        return False, None

    if detected_mime not in ALLOWED_MIME_TYPES:
        return False, None

    return True, detected_mime


@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return a shareable ID."""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename == '' or file.filename is None:
            return jsonify({'error': 'No file selected'}), 400

        # Generate a unique ID for the image
        image_id = str(uuid.uuid4())

        # Save file temporarily with a safe name (no extension yet)
        temp_path = os.path.join(UPLOAD_FOLDER, image_id + '.tmp')

        # Ensure the path is within the upload folder (path traversal prevention)
        real_upload_folder = os.path.realpath(UPLOAD_FOLDER)
        real_temp_path = os.path.realpath(temp_path)
        if not real_temp_path.startswith(real_upload_folder + os.sep):
            return jsonify({'error': 'Invalid file path'}), 400

        file.save(temp_path)

        # Validate the file is actually an image
        claimed_mime = file.content_type
        is_valid, detected_mime = is_safe_image(temp_path, claimed_mime)

        if not is_valid:
            # Remove the temp file
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return jsonify({'error': 'Invalid or unsupported image format'}), 400

        # Determine file extension based on detected MIME type
        ext_map = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp',
            'image/tiff': '.tiff',
            'image/svg+xml': '.svg',
            'image/x-icon': '.ico',
            'image/heic': '.heic',
            'image/heif': '.heif',
            'image/avif': '.avif',
        }

        extension = ext_map.get(detected_mime, '.bin')
        final_path = os.path.join(UPLOAD_FOLDER, image_id + extension)

        # Ensure final path is within upload folder
        real_final_path = os.path.realpath(final_path)
        if not real_final_path.startswith(real_upload_folder + os.sep):
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return jsonify({'error': 'Invalid file path'}), 400

        # Rename temp file to final file
        os.rename(temp_path, final_path)

        # Store metadata: image_id -> (filename, mime_type)
        # We encode this in the filename itself
        logger.info(f"Image uploaded successfully with ID: {image_id}")

        return jsonify({'id': image_id}), 200

    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large. Maximum size is 16MB'}), 400
    except Exception as e:
        logger.error(f"Upload error: {type(e).__name__}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<image_id>', methods=['GET'])
def view_image(image_id):
    """View an uploaded image by its ID."""
    try:
        # Validate image_id format (must be a valid UUID)
        try:
            uuid_obj = uuid.UUID(image_id)
            # Normalize to string form to prevent any manipulation
            safe_image_id = str(uuid_obj)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404

        # Look for the file in the upload folder
        real_upload_folder = os.path.realpath(UPLOAD_FOLDER)

        found_file = None
        found_mime = None

        ext_mime_map = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.tiff': 'image/tiff',
            '.tif': 'image/tiff',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.heic': 'image/heic',
            '.heif': 'image/heif',
            '.avif': 'image/avif',
        }

        for ext, mime in ext_mime_map.items():
            candidate = os.path.join(UPLOAD_FOLDER, safe_image_id + ext)
            real_candidate = os.path.realpath(candidate)

            # Path traversal check
            if not real_candidate.startswith(real_upload_folder + os.sep):
                continue

            if os.path.isfile(real_candidate):
                found_file = real_candidate
                found_mime = mime
                break

        if found_file is None:
            return jsonify({'error': 'Image not found'}), 404

        # Send the file inline (not as attachment) so it's viewable in browser
        response = send_file(
            found_file,
            mimetype=found_mime,
            as_attachment=False,
            conditional=True
        )

        # Override Content-Disposition to inline
        response.headers['Content-Disposition'] = 'inline'

        # For SVG, add extra security to prevent XSS
        if found_mime == 'image/svg+xml':
            response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline';"

        return response

    except Exception as e:
        logger.error(f"View image error: {type(e).__name__}")
        return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405


@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({'error': 'File too large. Maximum size is 16MB'}), 400


@app.errorhandler(500)
def internal_server_error(e):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)