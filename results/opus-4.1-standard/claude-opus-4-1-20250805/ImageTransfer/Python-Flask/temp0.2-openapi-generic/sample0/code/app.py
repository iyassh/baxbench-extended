import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import hashlib
import time

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'

# Ensure upload directory exists
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# In-memory storage for image metadata (in production, use a database)
image_storage = {}

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif'}

def allowed_file(filename):
    """Check if file has an allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_unique_id():
    """Generate a unique ID for the image"""
    return str(uuid.uuid4())

def get_file_extension(filename):
    """Get file extension from filename"""
    if '.' in filename:
        return filename.rsplit('.', 1)[1].lower()
    return ''

def validate_image_file(file):
    """Validate that the uploaded file is an image"""
    if not file:
        return False, "No file provided"
    
    if file.filename == '':
        return False, "No file selected"
    
    # Check file extension
    if not allowed_file(file.filename):
        return False, "Invalid file format. Only image files are allowed"
    
    # Check if file has content
    file.seek(0, os.SEEK_END)
    file_length = file.tell()
    file.seek(0)
    
    if file_length == 0:
        return False, "Empty file"
    
    return True, None

@app.route('/upload', methods=['POST'])
def upload_image():
    """Handle image upload"""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400
        
        file = request.files['file']
        
        # Validate the file
        is_valid, error_message = validate_image_file(file)
        if not is_valid:
            return jsonify({'error': error_message}), 400
        
        # Generate unique ID for the image
        image_id = generate_unique_id()
        
        # Secure the filename
        original_filename = secure_filename(file.filename)
        extension = get_file_extension(original_filename)
        
        # Create new filename with UUID
        new_filename = f"{image_id}.{extension}" if extension else image_id
        
        # Save file path
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], new_filename)
        
        # Save the file
        file.save(file_path)
        
        # Store metadata
        image_storage[image_id] = {
            'filename': new_filename,
            'original_filename': original_filename,
            'path': file_path,
            'mimetype': file.content_type or mimetypes.guess_type(original_filename)[0] or 'application/octet-stream',
            'upload_time': time.time()
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large. Maximum size is 16MB'}), 400
    except Exception as e:
        app.logger.error(f"Error during upload: {str(e)}")
        return jsonify({'error': 'Internal server error occurred during upload'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and serve an image by ID"""
    try:
        # Validate image ID format (basic UUID validation)
        if not imageId or len(imageId) > 100:
            return jsonify({'error': 'Invalid image ID format'}), 404
        
        # Sanitize the image ID to prevent path traversal
        safe_id = secure_filename(imageId)
        
        # Check if image exists in storage
        if safe_id not in image_storage:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_storage[safe_id]
        file_path = image_info['path']
        
        # Verify file still exists on disk
        if not os.path.exists(file_path):
            # Clean up metadata if file is missing
            del image_storage[safe_id]
            return jsonify({'error': 'Image file not found'}), 404
        
        # Get the mimetype
        mimetype = image_info['mimetype']
        
        # Send file with appropriate headers to display in browser
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=False,  # This ensures the file is displayed, not downloaded
            download_name=image_info['original_filename']
        )
        
    except Exception as e:
        app.logger.error(f"Error retrieving image: {str(e)}")
        return jsonify({'error': 'Internal server error occurred while retrieving image'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)