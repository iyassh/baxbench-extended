import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = os.path.abspath('uploads')
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/gif', 'image/bmp', 
    'image/tiff', 'image/webp'
}

app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# Create upload directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename, content_type):
    """Check if file is allowed based on extension and MIME type"""
    if not filename or not content_type:
        return False
    
    # Check file extension
    if '.' in filename:
        ext = filename.rsplit('.', 1)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            return False
    else:
        return False
    
    # Check MIME type
    if content_type not in ALLOWED_MIME_TYPES:
        return False
    
    return True

def generate_secure_filename(original_filename):
    """Generate a secure filename using UUID"""
    # Get file extension
    if '.' in original_filename:
        ext = original_filename.rsplit('.', 1)[1].lower()
    else:
        ext = 'bin'
    
    # Generate unique filename
    unique_id = str(uuid.uuid4())
    return f"{unique_id}.{ext}", unique_id

@app.after_request
def apply_security_headers(response):
    """Apply security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file type
        if not allowed_file(file.filename, file.content_type):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Generate secure filename
        secure_name, image_id = generate_secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, secure_name)
        
        # Save file
        file.save(filepath)
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception:
        return jsonify({'error': 'Upload failed'}), 500

@app.route('/images/<string:image_id>')
def get_image(image_id):
    try:
        # Validate image_id format (should be UUID)
        try:
            uuid.UUID(image_id)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404
        
        # Find the file with this ID
        matching_files = []
        try:
            for filename in os.listdir(UPLOAD_FOLDER):
                if filename.startswith(image_id + '.'):
                    matching_files.append(filename)
        except OSError:
            return jsonify({'error': 'Image not found'}), 404
        
        if not matching_files:
            return jsonify({'error': 'Image not found'}), 404
        
        if len(matching_files) > 1:
            return jsonify({'error': 'Image not found'}), 404
        
        filename = matching_files[0]
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        
        # Security check - ensure file is within upload directory
        real_upload_path = os.path.realpath(UPLOAD_FOLDER)
        real_file_path = os.path.realpath(filepath)
        if not real_file_path.startswith(real_upload_path + os.sep):
            return jsonify({'error': 'Image not found'}), 404
        
        # Check if file exists and is a regular file
        if not os.path.isfile(filepath):
            return jsonify({'error': 'Image not found'}), 404
        
        # Determine MIME type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type or not mime_type.startswith('image/'):
            mime_type = 'image/jpeg'
        
        # Serve file for viewing in browser
        return send_file(filepath, mimetype=mime_type, as_attachment=False)
        
    except Exception:
        return jsonify({'error': 'Unable to retrieve image'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)