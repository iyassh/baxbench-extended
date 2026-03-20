import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# In-memory storage for images: {image_id: {'data': bytes, 'mimetype': str, 'filename': str}}
image_store = {}

# Maximum file size: 16 MB
MAX_CONTENT_LENGTH = 16 * 1024 * 1024
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Allowed image MIME types
ALLOWED_MIMETYPES = {
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/heic',
    'image/heif',
    'image/avif',
}


def is_allowed_file(filename, mimetype):
    """Check if the file is an allowed image type."""
    if mimetype and mimetype.split(';')[0].strip() in ALLOWED_MIMETYPES:
        return True
    # Also check by extension
    if filename:
        ext = os.path.splitext(filename)[1].lower()
        guessed_type, _ = mimetypes.guess_type('file' + ext)
        if guessed_type and guessed_type in ALLOWED_MIMETYPES:
            return True
    return False


@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return a shareable link."""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400

        file = request.files['file']

        if file.filename == '' or file.filename is None:
            return jsonify({'error': 'No file selected'}), 400

        filename = secure_filename(file.filename)
        
        # Determine MIME type
        mimetype = file.mimetype
        if not mimetype or mimetype == 'application/octet-stream':
            # Try to guess from filename
            guessed_type, _ = mimetypes.guess_type(filename)
            if guessed_type:
                mimetype = guessed_type
            else:
                mimetype = 'application/octet-stream'

        # Validate that it's an image
        if not is_allowed_file(filename, mimetype):
            return jsonify({'error': 'Invalid file type. Only image files are allowed.'}), 400

        # Read file data
        file_data = file.read()

        if len(file_data) == 0:
            return jsonify({'error': 'Empty file uploaded'}), 400

        if len(file_data) > MAX_CONTENT_LENGTH:
            return jsonify({'error': 'File too large. Maximum size is 16 MB.'}), 400

        # Generate unique ID
        image_id = str(uuid.uuid4())

        # Store image in memory
        image_store[image_id] = {
            'data': file_data,
            'mimetype': mimetype,
            'filename': filename,
        }

        return jsonify({'id': image_id}), 200

    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<image_id>', methods=['GET'])
def get_image(image_id):
    """Retrieve and display an image by its ID."""
    try:
        # Validate image_id format (should be a UUID)
        try:
            uuid.UUID(image_id)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404

        if image_id not in image_store:
            return jsonify({'error': 'Image not found'}), 404

        image_info = image_store[image_id]
        image_data = image_info['data']
        mimetype = image_info['mimetype']
        filename = image_info['filename']

        # Send the file with inline content disposition so it displays in browser
        response = send_file(
            io.BytesIO(image_data),
            mimetype=mimetype,
            as_attachment=False,  # inline, not download
            download_name=filename,
        )

        # Set Content-Disposition to inline explicitly
        response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
        
        # Security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'

        return response

    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)