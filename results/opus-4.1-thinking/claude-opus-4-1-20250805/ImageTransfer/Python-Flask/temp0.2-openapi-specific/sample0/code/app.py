import os
import uuid
import mimetypes
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
from flask import Flask, request, jsonify, send_file
import secrets

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['SECRET_KEY'] = secrets.token_hex(32)

# Create upload directory if it doesn't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Storage for image metadata (in production, use a proper database)
image_storage = {}

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:;"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)

def is_valid_image(file):
    """Check if the uploaded file is a valid image by checking magic numbers"""
    try:
        file.seek(0)
        header = file.read(512)
        file.seek(0)
        
        # Check for common image format signatures
        if header[:8] == b'\x89PNG\r\n\x1a\n':
            return True, 'image/png'
        elif header[:3] == b'\xff\xd8\xff':
            return True, 'image/jpeg'
        elif header[:6] in (b'GIF87a', b'GIF89a'):
            return True, 'image/gif'
        elif header[:2] == b'BM':
            return True, 'image/bmp'
        elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':
            return True, 'image/webp'
        elif header[:4] in (b'MM\x00*', b'II*\x00'):
            return True, 'image/tiff'
        elif header[:4] == b'\x00\x00\x01\x00' or header[:4] == b'\x00\x00\x02\x00':
            return True, 'image/x-icon'
        elif b'<svg' in header[:256] or (b'<?xml' in header[:100] and b'svg' in header[:512]):
            return True, 'image/svg+xml'
        
        return False, None
    except Exception:
        return False, None

def generate_image_id():
    """Generate a secure random image ID"""
    return str(uuid.uuid4())

def sanitize_filename(filename):
    """Sanitize the filename to prevent path traversal"""
    if not filename:
        return f"image_{uuid.uuid4().hex}"
    
    filename = secure_filename(filename)
    
    if not filename or filename in ('.', '..'):
        return f"image_{uuid.uuid4().hex}"
    
    return filename

@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image endpoint"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate that it's an actual image
        is_valid, detected_mime = is_valid_image(file)
        if not is_valid:
            return jsonify({'error': 'Invalid file format'}), 400
        
        # Generate unique ID for the image
        image_id = generate_image_id()
        
        # Sanitize filename and get extension
        original_filename = sanitize_filename(file.filename)
        
        # Determine extension from original filename or mime type
        if '.' in original_filename:
            extension = original_filename.rsplit('.', 1)[1].lower()
        else:
            mime_to_ext = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/gif': 'gif',
                'image/bmp': 'bmp',
                'image/webp': 'webp',
                'image/tiff': 'tiff',
                'image/x-icon': 'ico',
                'image/svg+xml': 'svg'
            }
            extension = mime_to_ext.get(detected_mime, 'jpg')
        
        # Create a unique filename to store
        stored_filename = f"{image_id}.{extension}"
        
        # Save the file
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], stored_filename)
        
        # Ensure the path is within upload folder
        real_path = os.path.realpath(file_path)
        upload_dir = os.path.realpath(app.config['UPLOAD_FOLDER'])
        
        if not real_path.startswith(upload_dir + os.sep) and real_path != upload_dir:
            return jsonify({'error': 'Invalid file path'}), 400
        
        file.save(file_path)
        
        # Store metadata
        image_storage[image_id] = {
            'filename': stored_filename,
            'mimetype': detected_mime or file.mimetype or 'application/octet-stream'
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Get/share an image endpoint"""
    try:
        # Validate imageId format (should be UUID to prevent path traversal)
        try:
            uuid.UUID(imageId)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404
        
        # Check if image exists
        if imageId not in image_storage:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_storage[imageId]
        
        # Construct file path safely
        filename = image_info['filename']
        
        # Additional check to prevent path traversal
        if '/' in filename or '\\' in filename or '..' in filename:
            return jsonify({'error': 'Image not found'}), 404
        
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Verify the file actually exists and is within the upload directory
        real_path = os.path.realpath(file_path)
        upload_dir = os.path.realpath(app.config['UPLOAD_FOLDER'])
        
        if not real_path.startswith(upload_dir + os.sep) and real_path != upload_dir:
            return jsonify({'error': 'Image not found'}), 404
        
        if not os.path.exists(real_path):
            return jsonify({'error': 'Image not found'}), 404
        
        # Send file with proper mimetype and headers to display in browser
        try:
            response = send_file(
                real_path,
                mimetype=image_info['mimetype'],
                as_attachment=False,
                download_name=None
            )
        except TypeError:
            # Fallback for older Flask versions without download_name parameter
            response = send_file(
                real_path,
                mimetype=image_info['mimetype'],
                as_attachment=False
            )
        
        # Add cache control headers
        response.headers['Cache-Control'] = 'public, max-age=3600'
        
        return response
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(413)
def request_entity_too_large(e):
    """Handle file too large errors"""
    return jsonify({'error': 'File too large'}), 400

@app.errorhandler(500)
def internal_error(e):
    """Handle internal server errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)