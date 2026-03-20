import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import hashlib
import time

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# In-memory storage for image metadata (in production, use a database)
image_storage = {}

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'}

def allowed_file(filename):
    """Check if file has an allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_unique_id():
    """Generate a unique ID for uploaded images"""
    return str(uuid.uuid4())

def get_file_hash(file_data):
    """Generate SHA256 hash of file data"""
    return hashlib.sha256(file_data).hexdigest()

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
        
        # Read file data
        file_data = file.read()
        
        # Check if file is empty
        if len(file_data) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Reset file pointer
        file.seek(0)
        
        # Validate file type by checking magic bytes
        mime_type = mimetypes.guess_type(file.filename)[0]
        if not mime_type or not mime_type.startswith('image/'):
            # Additional check for SVG files
            if not (file.filename.lower().endswith('.svg') and file_data.startswith(b'<?xml')):
                return jsonify({'error': 'Invalid file type. Only images are allowed'}), 400
        
        # Generate unique ID
        image_id = generate_unique_id()
        
        # Secure the filename
        original_filename = secure_filename(file.filename)
        if not original_filename:
            original_filename = f"image_{image_id}"
        
        # Get file extension
        file_ext = ''
        if '.' in original_filename:
            file_ext = '.' + original_filename.rsplit('.', 1)[1].lower()
        
        # Create unique filename
        filename = f"{image_id}{file_ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Save file
        file.save(filepath)
        
        # Store metadata
        image_storage[image_id] = {
            'filename': filename,
            'original_filename': original_filename,
            'mime_type': mime_type or 'application/octet-stream',
            'upload_time': time.time(),
            'file_hash': get_file_hash(file_data)
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large. Maximum size is 16MB'}), 400
    except Exception as e:
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Validate image ID format (UUID)
        try:
            uuid.UUID(imageId)
        except ValueError:
            return jsonify({'error': 'Invalid image ID format'}), 404
        
        # Check if image exists
        if imageId not in image_storage:
            return jsonify({'error': 'Image not found'}), 404
        
        # Get image metadata
        image_info = image_storage[imageId]
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], image_info['filename'])
        
        # Check if file exists on disk
        if not os.path.exists(filepath):
            return jsonify({'error': 'Image file not found'}), 404
        
        # Determine mime type
        mime_type = image_info['mime_type']
        if not mime_type:
            mime_type = mimetypes.guess_type(filepath)[0] or 'application/octet-stream'
        
        # Send file with appropriate headers to display in browser
        return send_file(
            filepath,
            mimetype=mime_type,
            as_attachment=False,  # This ensures the file is displayed, not downloaded
            download_name=image_info['original_filename']
        )
        
    except Exception as e:
        app.logger.error(f"Get image error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)