import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import tempfile
import hashlib

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['SECRET_KEY'] = os.urandom(32)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# In-memory storage for uploaded images
uploaded_images = {}

# Allowed image MIME types
ALLOWED_IMAGE_TYPES = {
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 
    'image/bmp', 'image/webp', 'image/tiff', 'image/svg+xml'
}

def is_valid_image(file_content, filename):
    """Validate if the uploaded file is a valid image"""
    try:
        # Check MIME type based on file extension
        mime_type, _ = mimetypes.guess_type(filename)
        if mime_type not in ALLOWED_IMAGE_TYPES:
            return False
        
        # Basic file signature validation
        if len(file_content) < 8:
            return False
            
        # Check common image file signatures
        signatures = {
            b'\xFF\xD8\xFF': 'image/jpeg',
            b'\x89PNG\r\n\x1a\n': 'image/png',
            b'GIF87a': 'image/gif',
            b'GIF89a': 'image/gif',
            b'BM': 'image/bmp',
            b'RIFF': 'image/webp',
            b'II*\x00': 'image/tiff',
            b'MM\x00*': 'image/tiff'
        }
        
        for sig in signatures:
            if file_content.startswith(sig):
                return True
                
        # SVG check (simplified)
        if b'<svg' in file_content[:100].lower():
            return True
            
        return False
    except Exception:
        return False

def generate_secure_id():
    """Generate a secure random ID for uploaded images"""
    return str(uuid.uuid4())

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file was selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Secure the filename
        filename = secure_filename(file.filename)
        if not filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Read file content
        file_content = file.read()
        
        # Check file size
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Validate image
        if not is_valid_image(file_content, filename):
            return jsonify({'error': 'Invalid image file'}), 400
        
        # Generate secure ID
        image_id = generate_secure_id()
        
        # Determine MIME type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type or mime_type not in ALLOWED_IMAGE_TYPES:
            # Fallback MIME type detection
            if file_content.startswith(b'\xFF\xD8\xFF'):
                mime_type = 'image/jpeg'
            elif file_content.startswith(b'\x89PNG'):
                mime_type = 'image/png'
            elif file_content.startswith(b'GIF'):
                mime_type = 'image/gif'
            else:
                mime_type = 'application/octet-stream'
        
        # Store image data
        uploaded_images[image_id] = {
            'content': file_content,
            'mime_type': mime_type,
            'filename': filename
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception as e:
        # Log error without exposing sensitive information
        app.logger.error(f"Upload error: {type(e).__name__}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<string:image_id>', methods=['GET'])
def get_image(image_id):
    try:
        # Validate image_id format (UUID)
        try:
            uuid.UUID(image_id)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404
        
        # Check if image exists
        if image_id not in uploaded_images:
            return jsonify({'error': 'Image not found'}), 404
        
        image_data = uploaded_images[image_id]
        
        # Create temporary file to serve the image
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(image_data['content'])
            temp_file_path = temp_file.name
        
        try:
            # Serve the file with proper MIME type
            response = send_file(
                temp_file_path,
                mimetype=image_data['mime_type'],
                as_attachment=False,  # Display in browser, not download
                download_name=image_data['filename']
            )
            
            # Add cache control headers
            response.headers['Cache-Control'] = 'public, max-age=3600'
            
            return response
        finally:
            # Clean up temporary file
            try:
                os.unlink(temp_file_path)
            except OSError:
                pass
                
    except Exception as e:
        # Log error without exposing sensitive information
        app.logger.error(f"Image retrieval error: {type(e).__name__}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)