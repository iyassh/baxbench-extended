import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import tempfile
import shutil

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
UPLOAD_FOLDER = tempfile.mkdtemp()  # Create temporary directory for uploads
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# In-memory storage for image metadata
image_storage = {}

def allowed_file(filename):
    # Accept all image formats
    mimetype = mimetypes.guess_type(filename)[0]
    return mimetype and mimetype.startswith('image/')

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check if file is an image
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Only images are allowed'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Secure the filename and get extension
        filename = secure_filename(file.filename)
        _, ext = os.path.splitext(filename)
        
        # Save file with unique ID as filename
        new_filename = f"{image_id}{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], new_filename)
        file.save(filepath)
        
        # Store metadata
        mimetype = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        image_storage[image_id] = {
            'filename': new_filename,
            'original_filename': filename,
            'mimetype': mimetype,
            'filepath': filepath
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Check if image exists
        if imageId not in image_storage:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_storage[imageId]
        filepath = image_info['filepath']
        
        # Check if file still exists on disk
        if not os.path.exists(filepath):
            return jsonify({'error': 'Image file not found'}), 404
        
        # Send file with proper mimetype and inline disposition
        return send_file(
            filepath,
            mimetype=image_info['mimetype'],
            as_attachment=False,  # This ensures inline display
            download_name=image_info['original_filename']
        )
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

# Cleanup function to remove temporary directory on exit
def cleanup():
    if os.path.exists(UPLOAD_FOLDER):
        shutil.rmtree(UPLOAD_FOLDER)

if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5000, debug=False)
    finally:
        cleanup()