import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import json

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = 'uploads'
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif'}

app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Ensure upload directory exists
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# In-memory storage for image metadata (in production, use a database)
# Format: {image_id: {'filename': original_filename, 'mimetype': mimetype, 'path': file_path}}
image_metadata = {}

# Load metadata if exists (for persistence across restarts)
METADATA_FILE = 'image_metadata.json'
if os.path.exists(METADATA_FILE):
    try:
        with open(METADATA_FILE, 'r') as f:
            image_metadata = json.load(f)
    except:
        image_metadata = {}

def save_metadata():
    """Save metadata to file for persistence"""
    try:
        with open(METADATA_FILE, 'w') as f:
            json.dump(image_metadata, f)
    except:
        pass

def is_valid_image(file):
    """Check if uploaded file is a valid image"""
    if not file:
        return False
    
    # Check if file has a filename
    if file.filename == '':
        return False
    
    # Get file extension
    filename = secure_filename(file.filename)
    if '.' not in filename:
        return True  # Allow files without extension, mimetype will be detected
    
    # We accept all formats as per the API spec, so just return True
    return True

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Validate file
        if not is_valid_image(file):
            return jsonify({'error': 'Invalid or no file provided'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get original filename (secured)
        original_filename = secure_filename(file.filename) if file.filename else 'image'
        
        # Detect mimetype
        file.seek(0)
        file_content = file.read()
        file.seek(0)
        
        # Try to detect mimetype from content
        mimetype = None
        if file.content_type and file.content_type.startswith('image/'):
            mimetype = file.content_type
        else:
            # Try to guess from filename
            guessed_type = mimetypes.guess_type(original_filename)[0]
            if guessed_type:
                mimetype = guessed_type
            else:
                # Default to binary if can't determine
                mimetype = 'application/octet-stream'
        
        # Save file with UUID as filename
        file_extension = os.path.splitext(original_filename)[1] if '.' in original_filename else ''
        saved_filename = f"{image_id}{file_extension}"
        file_path = os.path.join(UPLOAD_FOLDER, saved_filename)
        
        # Save the file
        with open(file_path, 'wb') as f:
            f.write(file_content)
        
        # Store metadata
        image_metadata[image_id] = {
            'filename': original_filename,
            'mimetype': mimetype,
            'path': file_path
        }
        save_metadata()
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception as e:
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Validate imageId format (prevent directory traversal)
        if not imageId or '/' in imageId or '\\' in imageId or '..' in imageId:
            return jsonify({'error': 'Invalid image ID'}), 404
        
        # Check if image exists
        if imageId not in image_metadata:
            return jsonify({'error': 'Image not found'}), 404
        
        metadata = image_metadata[imageId]
        file_path = metadata['path']
        
        # Check if file exists on disk
        if not os.path.exists(file_path):
            return jsonify({'error': 'Image file not found'}), 404
        
        # Get mimetype
        mimetype = metadata.get('mimetype', 'application/octet-stream')
        
        # Send file with inline disposition so it displays in browser
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=False,  # This ensures inline display
            download_name=metadata['filename']
        )
        
    except Exception as e:
        app.logger.error(f"Get image error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)