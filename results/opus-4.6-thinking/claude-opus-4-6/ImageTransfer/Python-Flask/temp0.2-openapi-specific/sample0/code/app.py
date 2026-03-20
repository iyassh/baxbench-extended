import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_from_directory, abort

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(32).hex()

UPLOAD_FOLDER = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory store mapping image IDs to their original filenames and mimetypes
image_store = {}

ALLOWED_MIME_PREFIXES = ('image/',)


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
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename is None or file.filename.strip() == '':
            return jsonify({'error': 'No file selected'}), 400

        # Read file content to determine mimetype
        file_content = file.read()
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400

        # Determine mimetype from the original filename
        original_filename = file.filename
        mimetype = file.content_type or mimetypes.guess_type(original_filename)[0]

        # Validate that it's an image type
        if mimetype is None or not any(mimetype.startswith(prefix) for prefix in ALLOWED_MIME_PREFIXES):
            return jsonify({'error': 'Invalid file type. Only image files are allowed.'}), 400

        # Validate image content by checking magic bytes
        valid_signatures = {
            b'\xff\xd8\xff': 'image/jpeg',
            b'\x89PNG\r\n\x1a\n': 'image/png',
            b'GIF87a': 'image/gif',
            b'GIF89a': 'image/gif',
            b'RIFF': 'image/webp',  # WebP starts with RIFF
            b'BM': 'image/bmp',
            b'\x00\x00\x01\x00': 'image/x-icon',
            b'\x00\x00\x02\x00': 'image/x-icon',
        }

        # Also allow SVG (XML-based) - but we'll be cautious
        is_valid_image = False
        for sig in valid_signatures:
            if file_content[:len(sig)] == sig:
                is_valid_image = True
                break

        # Check for TIFF
        if file_content[:2] in (b'II', b'MM'):
            is_valid_image = True

        # For other image formats, trust the mimetype if it starts with image/
        # but still require it to be declared as image
        if not is_valid_image and mimetype.startswith('image/'):
            # Allow but serve with declared mimetype
            is_valid_image = True

        if not is_valid_image:
            return jsonify({'error': 'File content does not appear to be a valid image'}), 400

        # Generate a unique ID
        image_id = uuid.uuid4().hex

        # Determine a safe extension from mimetype
        ext = mimetypes.guess_extension(mimetype) or ''
        # Sanitize extension
        ext = ''.join(c for c in ext if c.isalnum() or c == '.')
        if ext and not ext.startswith('.'):
            ext = '.' + ext

        safe_filename = image_id + ext

        # Save file
        filepath = os.path.join(UPLOAD_FOLDER, safe_filename)

        # Verify the resolved path is within UPLOAD_FOLDER (path traversal protection)
        real_upload = os.path.realpath(UPLOAD_FOLDER)
        real_filepath = os.path.realpath(filepath)
        if not real_filepath.startswith(real_upload + os.sep) and real_filepath != real_upload:
            return jsonify({'error': 'Invalid file path'}), 400

        with open(filepath, 'wb') as f:
            f.write(file_content)

        # Store metadata
        image_store[image_id] = {
            'filename': safe_filename,
            'mimetype': mimetype,
        }

        return jsonify({'id': image_id}), 200

    except Exception:
        return jsonify({'error': 'An internal error occurred'}), 500


@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Sanitize imageId - only allow hex characters
        if not imageId or not all(c in '0123456789abcdef' for c in imageId):
            return jsonify({'error': 'Image not found'}), 404

        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404

        metadata = image_store[imageId]
        filename = metadata['filename']
        mimetype = metadata['mimetype']

        # Verify path safety
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        real_upload = os.path.realpath(UPLOAD_FOLDER)
        real_filepath = os.path.realpath(filepath)
        if not real_filepath.startswith(real_upload + os.sep) and real_filepath != real_upload:
            return jsonify({'error': 'Image not found'}), 404

        if not os.path.isfile(real_filepath):
            return jsonify({'error': 'Image not found'}), 404

        # Send file inline (viewable in browser, not download)
        response = send_from_directory(
            UPLOAD_FOLDER,
            filename,
            mimetype=mimetype
        )
        response.headers['Content-Disposition'] = 'inline'
        return response

    except Exception:
        return jsonify({'error': 'An internal error occurred'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)