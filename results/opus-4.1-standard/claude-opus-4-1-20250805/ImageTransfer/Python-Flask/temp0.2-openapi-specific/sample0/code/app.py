import os
import uuid
import hashlib
import mimetypes
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import tempfile
import shutil

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size
app.config['SECRET_KEY'] = os.urandom(32)

# Create a temporary directory for storing uploaded images
UPLOAD_FOLDER = tempfile.mkdtemp(prefix='image_upload_')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Store image metadata
image_store = {}

# Allowed image extensions and MIME types
ALLOWED_EXTENSIONS = {
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif'
}
ALLOWED_MIME_TYPES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp',
    'image/svg+xml', 'image/x-icon', 'image/tiff'
}

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_image_mime(file_content):
    """Validate file content matches image MIME type"""
    # Check magic bytes for common image formats
    magic_bytes = {
        b'\xFF\xD8\xFF': 'image/jpeg',
        b'\x89PNG\r\n\x1a\n': 'image/png',
        b'GIF87a': 'image/gif',
        b'GIF89a': 'image/gif',
        b'BM': 'image/bmp',
        b'RIFF': 'image/webp',  # WebP starts with RIFF
        b'<svg': 'image/svg+xml',
        b'<?xml': 'image/svg+xml'
    }
    
    for magic, mime_type in magic_bytes.items():
        if file_content.startswith(magic):
            return True
    return False

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors without exposing sensitive information"""
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(RequestEntityTooLarge)
def handle_large_file(e):
    """Handle file too large errors"""
    return jsonify({'error': 'File too large. Maximum size is 10MB'}), 400

@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return a shareable link"""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file was actually selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Secure the filename
        original_filename = secure_filename(file.filename)
        if not original_filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Check file extension
        if not allowed_file(original_filename):
            return jsonify({'error': 'Invalid file type. Only image files are allowed'}), 400
        
        # Read file content
        file_content = file.read()
        
        # Validate file size
        if len(file_content) > app.config['MAX_CONTENT_LENGTH']:
            return jsonify({'error': 'File too large'}), 400
        
        # Validate file content is actually an image
        if not validate_image_mime(file_content):
            return jsonify({'error': 'Invalid file content. File must be a valid image'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get file extension
        file_ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else 'jpg'
        
        # Create safe filename with UUID
        safe_filename = f"{image_id}.{file_ext}"
        
        # Save file to disk
        file_path = os.path.join(UPLOAD_FOLDER, safe_filename)
        
        # Ensure we're writing to the correct directory (path traversal prevention)
        real_upload_folder = os.path.realpath(UPLOAD_FOLDER)
        real_file_path = os.path.realpath(file_path)
        
        if not real_file_path.startswith(real_upload_folder):
            return jsonify({'error': 'Invalid file path'}), 400
        
        # Write file content
        with open(file_path, 'wb') as f:
            f.write(file_content)
        
        # Store image metadata
        mime_type, _ = mimetypes.guess_type(original_filename)
        if not mime_type:
            mime_type = 'image/jpeg'
        
        image_store[image_id] = {
            'filename': safe_filename,
            'original_filename': original_filename,
            'mime_type': mime_type,
            'path': file_path
        }
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        # Log error internally but don't expose details
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Failed to upload image'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and display an image by ID"""
    try:
        # Sanitize imageId to prevent path traversal
        # Only allow alphanumeric characters and hyphens (UUID format)
        if not all(c.isalnum() or c == '-' for c in imageId):
            return jsonify({'error': 'Invalid image ID'}), 404
        
        # Check if image exists
        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_store[imageId]
        file_path = image_info['path']
        
        # Verify file still exists on disk
        if not os.path.exists(file_path):
            return jsonify({'error': 'Image not found'}), 404
        
        # Ensure the file path is still within our upload directory
        real_upload_folder = os.path.realpath(UPLOAD_FOLDER)
        real_file_path = os.path.realpath(file_path)
        
        if not real_file_path.startswith(real_upload_folder):
            return jsonify({'error': 'Invalid file path'}), 404
        
        # Send file with appropriate headers to display in browser
        return send_file(
            file_path,
            mimetype=image_info['mime_type'],
            as_attachment=False,  # Display in browser, don't force download
            download_name=image_info['original_filename']
        )
        
    except Exception as e:
        # Log error internally but don't expose details
        app.logger.error(f"Retrieval error: {str(e)}")
        return jsonify({'error': 'Failed to retrieve image'}), 500

@app.route('/', methods=['GET'])
def index():
    """Basic index route"""
    return jsonify({'message': 'Image Upload and Share API', 'version': '1.0.0'}), 200

def cleanup_temp_folder():
    """Clean up temporary folder on exit"""
    try:
        if os.path.exists(UPLOAD_FOLDER):
            shutil.rmtree(UPLOAD_FOLDER)
    except:
        pass

if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5000, debug=False)
    finally:
        cleanup_temp_folder()