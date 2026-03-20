import os
import uuid
import mimetypes
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = Path(tempfile.gettempdir()) / "image_uploads"
UPLOAD_FOLDER.mkdir(exist_ok=True)
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico', 'heic'
}

# Store metadata about uploaded images
image_metadata = {}


def allowed_file(filename):
    """Check if file extension is allowed."""
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def get_file_mimetype(filepath):
    """Get the MIME type of a file."""
    mimetype, _ = mimetypes.guess_type(filepath)
    return mimetype or 'application/octet-stream'


@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return a shareable link."""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file has a filename
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file extension
        if not allowed_file(file.filename):
            return jsonify({'error': 'File type not allowed. Allowed types: ' + ', '.join(ALLOWED_EXTENSIONS)}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': f'File size exceeds maximum allowed size of {MAX_FILE_SIZE / 1024 / 1024}MB'}), 400
        
        if file_size == 0:
            return jsonify({'error': 'File is empty'}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Get original filename and extension
        original_filename = file.filename
        ext = original_filename.rsplit('.', 1)[1].lower()
        
        # Create safe filename
        safe_filename = f"{image_id}.{ext}"
        filepath = UPLOAD_FOLDER / safe_filename
        
        # Save file
        file.save(str(filepath))
        
        # Store metadata
        image_metadata[image_id] = {
            'filename': safe_filename,
            'original_filename': original_filename,
            'mimetype': get_file_mimetype(str(filepath))
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<image_id>', methods=['GET'])
def get_image(image_id):
    """Retrieve and display an image."""
    try:
        # Validate image_id format (UUID)
        try:
            uuid.UUID(image_id)
        except ValueError:
            return jsonify({'error': 'Invalid image ID format'}), 404
        
        # Check if image exists in metadata
        if image_id not in image_metadata:
            return jsonify({'error': 'Image not found'}), 404
        
        metadata = image_metadata[image_id]
        filepath = UPLOAD_FOLDER / metadata['filename']
        
        # Check if file actually exists
        if not filepath.exists():
            return jsonify({'error': 'Image not found'}), 404
        
        # Get MIME type
        mimetype = metadata['mimetype']
        
        # Send file with inline disposition to view in browser
        return send_file(
            str(filepath),
            mimetype=mimetype,
            as_attachment=False,
            download_name=metadata['original_filename']
        )
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error."""
    return jsonify({'error': 'File size exceeds maximum allowed size'}), 413


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405


if __name__ == '__main__':
    import tempfile
    app.run(host='0.0.0.0', port=5000, debug=False)