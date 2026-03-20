import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import tempfile
import shutil

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
UPLOAD_FOLDER = tempfile.mkdtemp()
ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'svg', 'ico'
}

# In-memory storage for image metadata
image_store = {}

def allowed_file(filename):
    """Check if the file extension is allowed"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def is_image_file(file_path):
    """Check if file is actually an image by checking MIME type"""
    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type and mime_type.startswith('image/')

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
        
        # Validate filename
        if not file.filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Secure the filename
        filename = secure_filename(file.filename)
        if not filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Check file extension
        if not allowed_file(filename):
            return jsonify({'error': 'File type not allowed'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get file extension
        file_extension = filename.rsplit('.', 1)[1].lower()
        stored_filename = f"{image_id}.{file_extension}"
        file_path = os.path.join(UPLOAD_FOLDER, stored_filename)
        
        # Save the file
        file.save(file_path)
        
        # Verify it's actually an image file
        if not is_image_file(file_path):
            os.remove(file_path)
            return jsonify({'error': 'File is not a valid image'}), 400
        
        # Store metadata
        image_store[image_id] = {
            'filename': stored_filename,
            'original_filename': filename,
            'path': file_path,
            'mime_type': mimetypes.guess_type(file_path)[0]
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<string:image_id>', methods=['GET'])
def get_image(image_id):
    try:
        # Validate image_id format (UUID)
        try:
            uuid.UUID(image_id)
        except ValueError:
            return jsonify({'error': 'Invalid image ID format'}), 404
        
        # Check if image exists
        if image_id not in image_store:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_store[image_id]
        file_path = image_info['path']
        
        # Check if file still exists on disk
        if not os.path.exists(file_path):
            # Clean up orphaned metadata
            del image_store[image_id]
            return jsonify({'error': 'Image not found'}), 404
        
        # Get MIME type
        mime_type = image_info['mime_type']
        if not mime_type:
            mime_type = 'application/octet-stream'
        
        # Return the image file with proper MIME type
        return send_file(
            file_path,
            mimetype=mime_type,
            as_attachment=False,  # Display in browser, don't download
            download_name=image_info['original_filename']
        )
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 400

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

# Cleanup function to remove temporary files on shutdown
def cleanup():
    try:
        shutil.rmtree(UPLOAD_FOLDER)
    except:
        pass

import atexit
atexit.register(cleanup)

if __name__ == '__main__':
    # Ensure upload directory exists
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=False)