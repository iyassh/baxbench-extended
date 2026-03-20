import os
import uuid
import mimetypes
from pathlib import Path
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'uploads')

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Allowed image extensions and MIME types for security
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'}
ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp',
    'image/webp', 'image/svg+xml', 'image/x-icon', 'image/tiff'
}

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_image_content(file_data):
    """Basic validation of image content by checking magic numbers"""
    if len(file_data) < 8:
        return False
    
    # Check common image format magic numbers
    magic_numbers = {
        b'\x89PNG\r\n\x1a\n': 'png',
        b'\xff\xd8\xff': 'jpeg',
        b'GIF87a': 'gif',
        b'GIF89a': 'gif',
        b'BM': 'bmp',
        b'RIFF': 'webp',
        b'<svg': 'svg',
        b'<?xml': 'svg',
        b'\x00\x00\x01\x00': 'ico',
        b'\x00\x00\x02\x00': 'ico',
        b'MM\x00*': 'tiff',
        b'II*\x00': 'tiff'
    }
    
    for magic, format in magic_numbers.items():
        if file_data.startswith(magic):
            return True
    
    return False

@app.before_request
def before_request():
    """Add security headers to all responses"""
    # Note: These headers will be added to the response in after_request
    pass

@app.after_request
def after_request(response):
    """Add security headers to prevent common vulnerabilities"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(404)
def not_found_error(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information"""
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(RequestEntityTooLarge)
def handle_large_file(error):
    """Handle file too large errors"""
    return jsonify({'error': 'File too large. Maximum size is 16MB'}), 400

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
        
        # Validate filename
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Read file data for validation
        file_data = file.read()
        file.seek(0)  # Reset file pointer
        
        # Validate file content
        if not validate_image_content(file_data):
            return jsonify({'error': 'Invalid image content'}), 400
        
        # Check MIME type
        mime_type = file.content_type
        if mime_type not in ALLOWED_MIME_TYPES:
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Secure the filename and get extension
        filename = secure_filename(file.filename)
        file_ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else 'jpg'
        
        # Create new filename with UUID
        new_filename = f"{image_id}.{file_ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], new_filename)
        
        # Ensure the path is within upload folder (prevent directory traversal)
        filepath = os.path.abspath(filepath)
        upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
        if not filepath.startswith(upload_folder):
            return jsonify({'error': 'Invalid file path'}), 400
        
        # Save the file
        file.save(filepath)
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        # Don't expose internal error details
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and display an uploaded image"""
    try:
        # Validate imageId format (should be UUID)
        try:
            uuid.UUID(imageId)
        except ValueError:
            abort(404)
        
        # Find the image file
        image_path = None
        for ext in ALLOWED_EXTENSIONS:
            potential_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{imageId}.{ext}")
            if os.path.exists(potential_path):
                image_path = potential_path
                break
        
        if not image_path:
            abort(404)
        
        # Ensure the path is within upload folder (prevent directory traversal)
        image_path = os.path.abspath(image_path)
        upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
        if not image_path.startswith(upload_folder):
            abort(404)
        
        # Get MIME type
        mime_type, _ = mimetypes.guess_type(image_path)
        if not mime_type or mime_type not in ALLOWED_MIME_TYPES:
            mime_type = 'application/octet-stream'
        
        # Send file with appropriate headers
        return send_file(
            image_path,
            mimetype=mime_type,
            as_attachment=False,  # Display in browser instead of download
            download_name=None
        )
        
    except FileNotFoundError:
        return jsonify({'error': 'Image not found'}), 404
    except Exception as e:
        # Don't expose internal error details
        app.logger.error(f"Get image error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)