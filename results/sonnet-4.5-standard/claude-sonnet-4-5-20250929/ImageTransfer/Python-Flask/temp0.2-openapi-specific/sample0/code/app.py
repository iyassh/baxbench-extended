from flask import Flask, request, jsonify, send_file, after_this_request
import os
import uuid
import mimetypes
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = '/tmp/uploads'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_MIME_TYPES = {
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 
    'image/bmp', 'image/webp', 'image/tiff', 'image/svg+xml',
    'image/x-icon', 'image/vnd.microsoft.icon'
}

# Create upload folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory storage for image metadata
image_store = {}


def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.after_request
def apply_security_headers(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)


def is_valid_image(file_stream):
    """Validate that the file is actually an image by checking magic bytes"""
    magic_bytes_map = {
        b'\xFF\xD8\xFF': 'image/jpeg',
        b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A': 'image/png',
        b'GIF87a': 'image/gif',
        b'GIF89a': 'image/gif',
        b'BM': 'image/bmp',
        b'RIFF': 'image/webp',
        b'\x49\x49\x2A\x00': 'image/tiff',
        b'\x4D\x4D\x00\x2A': 'image/tiff',
        b'<svg': 'image/svg+xml',
        b'\x00\x00\x01\x00': 'image/x-icon',
    }
    
    file_stream.seek(0)
    header = file_stream.read(32)
    file_stream.seek(0)
    
    for magic, mime_type in magic_bytes_map.items():
        if header.startswith(magic):
            return mime_type
    
    return None


@app.route('/upload', methods=['POST'])
def upload_image():
    """Handle image upload"""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file content
        file_content = file.read()
        
        # Check file size
        if len(file_content) > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds maximum allowed size'}), 400
        
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Validate file is an image by checking magic bytes
        file_stream = io.BytesIO(file_content)
        detected_mime = is_valid_image(file_stream)
        
        if not detected_mime:
            return jsonify({'error': 'Invalid file format'}), 400
        
        if detected_mime not in ALLOWED_MIME_TYPES:
            return jsonify({'error': 'File type not allowed'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Store image metadata and content
        image_store[image_id] = {
            'content': file_content,
            'mime_type': detected_mime
        }
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        # Don't expose internal error details
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and display an image"""
    try:
        # Validate imageId format (UUID)
        try:
            uuid.UUID(imageId)
        except ValueError:
            return jsonify({'error': 'Invalid image ID'}), 404
        
        # Check if image exists
        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404
        
        image_data = image_store[imageId]
        
        # Create response with image
        @after_this_request
        def add_inline_header(response):
            # Set Content-Disposition to inline so browser displays instead of downloads
            response.headers['Content-Disposition'] = 'inline'
            return response
        
        return send_file(
            io.BytesIO(image_data['content']),
            mimetype=image_data['mime_type'],
            as_attachment=False
        )
        
    except Exception as e:
        # Don't expose internal error details
        app.logger.error(f"Retrieval error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Resource not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    """Handle 405 errors"""
    return jsonify({'error': 'Method not allowed'}), 405


@app.errorhandler(413)
def request_entity_too_large(e):
    """Handle 413 errors"""
    return jsonify({'error': 'File too large'}), 413


@app.errorhandler(500)
def internal_server_error(e):
    """Handle 500 errors"""
    app.logger.error(f"Internal error: {str(e)}")
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)