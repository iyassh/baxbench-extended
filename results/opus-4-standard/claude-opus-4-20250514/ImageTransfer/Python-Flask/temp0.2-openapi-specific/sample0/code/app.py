import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import hashlib
import hmac

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', os.urandom(32).hex())

# Allowed image extensions and MIME types
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'}
ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 
    'image/webp', 'image/svg+xml', 'image/x-icon', 'image/tiff'
}

# Create upload directory if it doesn't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_mime_type(file):
    """Validate file MIME type"""
    file.seek(0)
    mime_type = mimetypes.guess_type(file.filename)[0]
    if mime_type and mime_type in ALLOWED_MIME_TYPES:
        return True
    return False

def generate_secure_filename(original_filename):
    """Generate a secure filename with UUID"""
    ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
    return f"{uuid.uuid4().hex}.{ext}" if ext else uuid.uuid4().hex

def validate_image_id(image_id):
    """Validate image ID format to prevent path traversal"""
    # Only allow alphanumeric characters, dots, hyphens and underscores
    if not image_id:
        return False
    
    # Check for path traversal attempts
    if '..' in image_id or '/' in image_id or '\\' in image_id:
        return False
    
    # Check if it matches our expected format (UUID with extension)
    parts = image_id.split('.')
    if len(parts) > 2:
        return False
    
    # Validate UUID part
    try:
        uuid_part = parts[0]
        if len(uuid_part) != 32 or not all(c in '0123456789abcdef' for c in uuid_part):
            return False
    except:
        return False
    
    # Validate extension if present
    if len(parts) == 2:
        if parts[1] not in ALLOWED_EXTENSIONS:
            return False
    
    return True

@app.after_request
def set_security_headers(response):
    """Set security headers for all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.errorhandler(413)
def request_entity_too_large(e):
    """Handle file too large error"""
    return jsonify({'error': 'File too large. Maximum size is 16MB.'}), 413

@app.errorhandler(500)
def internal_error(e):
    """Handle internal server errors without exposing sensitive information"""
    app.logger.error(f"Internal error: {str(e)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic exception handler to prevent information leakage"""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return its ID"""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file was selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file extension
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Only image files are allowed.'}), 400
        
        # Validate MIME type
        if not validate_mime_type(file):
            return jsonify({'error': 'Invalid file type. Only image files are allowed.'}), 400
        
        # Generate secure filename
        filename = generate_secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Save file
        file.seek(0)
        file.save(filepath)
        
        # Verify the saved file is actually an image by checking its content
        try:
            with open(filepath, 'rb') as f:
                header = f.read(512)
                # Basic validation of common image file signatures
                image_signatures = [
                    b'\xFF\xD8\xFF',  # JPEG
                    b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A',  # PNG
                    b'GIF87a', b'GIF89a',  # GIF
                    b'BM',  # BMP
                    b'RIFF',  # WEBP (partial check)
                    b'<svg',  # SVG
                    b'<?xml',  # SVG with XML declaration
                    b'\x00\x00\x01\x00',  # ICO
                    b'II\x2A\x00', b'MM\x00\x2A'  # TIFF
                ]
                
                if not any(header.startswith(sig) for sig in image_signatures):
                    # Remove the file if it's not a valid image
                    os.remove(filepath)
                    return jsonify({'error': 'Invalid file content. File is not a valid image.'}), 400
        except Exception:
            # If we can't verify, remove the file for safety
            if os.path.exists(filepath):
                os.remove(filepath)
            return jsonify({'error': 'Failed to process uploaded file'}), 500
        
        return jsonify({'id': filename}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large. Maximum size is 16MB.'}), 413
    except Exception as e:
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Failed to upload file'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and display an image"""
    try:
        # Validate image ID to prevent path traversal
        if not validate_image_id(imageId):
            abort(404)
        
        # Construct file path safely
        filename = secure_filename(imageId)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Check if file exists and is within upload directory
        if not os.path.exists(filepath):
            return jsonify({'error': 'Image not found'}), 404
        
        # Verify the path is within upload directory (defense in depth)
        real_filepath = os.path.realpath(filepath)
        real_upload_dir = os.path.realpath(app.config['UPLOAD_FOLDER'])
        if not real_filepath.startswith(real_upload_dir):
            abort(404)
        
        # Determine MIME type
        mime_type = mimetypes.guess_type(filepath)[0]
        if not mime_type or mime_type not in ALLOWED_MIME_TYPES:
            mime_type = 'application/octet-stream'
        
        # Send file with appropriate headers to display in browser
        return send_file(
            filepath,
            mimetype=mime_type,
            as_attachment=False,  # Display in browser instead of download
            download_name=None,  # Don't suggest download
            conditional=True,  # Support caching
            etag=True  # Generate ETag for caching
        )
        
    except Exception as e:
        app.logger.error(f"Error retrieving image: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)