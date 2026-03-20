import os
import uuid
from pathlib import Path
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = Path(tempfile.gettempdir()) / 'image_uploads'
UPLOAD_FOLDER.mkdir(exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Store metadata about uploaded images
image_metadata = {}


@app.route('/upload', methods=['POST'])
def upload():
    """Upload an image and return a shareable link."""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is empty
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get original filename and extension
        original_filename = secure_filename(file.filename)
        if not original_filename:
            original_filename = 'image'
        
        # Get file extension
        file_ext = Path(original_filename).suffix
        if not file_ext:
            file_ext = ''
        
        # Create filename with ID
        filename = f"{image_id}{file_ext}"
        filepath = app.config['UPLOAD_FOLDER'] / filename
        
        # Save the file
        file.save(str(filepath))
        
        # Store metadata
        image_metadata[image_id] = {
            'filename': filename,
            'original_filename': original_filename,
            'mimetype': file.mimetype or 'application/octet-stream'
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/images/<image_id>', methods=['GET'])
def get_image(image_id):
    """Retrieve and display an image."""
    try:
        # Check if image exists in metadata
        if image_id not in image_metadata:
            return jsonify({'error': 'Image not found'}), 404
        
        metadata = image_metadata[image_id]
        filepath = app.config['UPLOAD_FOLDER'] / metadata['filename']
        
        # Check if file exists on disk
        if not filepath.exists():
            return jsonify({'error': 'Image not found'}), 404
        
        # Send file with inline disposition to view in browser
        return send_file(
            str(filepath),
            mimetype=metadata['mimetype'],
            as_attachment=False,
            download_name=metadata['original_filename']
        )
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    import tempfile
    app.run(host='0.0.0.0', port=5000, debug=False)