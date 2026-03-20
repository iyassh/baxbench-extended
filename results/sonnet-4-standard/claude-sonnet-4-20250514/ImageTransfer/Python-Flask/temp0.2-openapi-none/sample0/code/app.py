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
UPLOAD_FOLDER = tempfile.mkdtemp()
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# In-memory storage for image metadata
image_store = {}

def allowed_file(filename):
    """Check if the file is an image based on mimetype"""
    if not filename:
        return False
    
    mimetype, _ = mimetypes.guess_type(filename)
    return mimetype and mimetype.startswith('image/')

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
        
        # Check if file is an image
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Only images are allowed.'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get file extension and mimetype
        filename = secure_filename(file.filename)
        _, ext = os.path.splitext(filename)
        mimetype, _ = mimetypes.guess_type(filename)
        
        # Create filename with unique ID
        stored_filename = f"{image_id}{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], stored_filename)
        
        # Save file
        file.save(filepath)
        
        # Store metadata
        image_store[image_id] = {
            'filepath': filepath,
            'mimetype': mimetype or 'application/octet-stream',
            'original_filename': filename
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<string:imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Check if image exists
        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_store[imageId]
        filepath = image_info['filepath']
        
        # Check if file still exists on disk
        if not os.path.exists(filepath):
            return jsonify({'error': 'Image file not found'}), 404
        
        # Return the image file with proper mimetype
        return send_file(
            filepath,
            mimetype=image_info['mimetype'],
            as_attachment=False  # Display in browser, not download
        )
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure upload directory exists
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    
    # Start the Flask development server
    app.run(host='0.0.0.0', port=5000, debug=True)