import os
import uuid
import mimetypes
from pathlib import Path
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = Path(tempfile.gettempdir()) / "image_uploads"
UPLOAD_FOLDER.mkdir(exist_ok=True)
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

def allowed_file(filename):
    """Check if file extension is allowed"""
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS

def get_image_path(image_id):
    """Safely construct image path to prevent directory traversal"""
    # Validate image_id format (UUID)
    try:
        uuid.UUID(image_id)
    except ValueError:
        return None
    
    image_path = UPLOAD_FOLDER / image_id
    
    # Ensure the resolved path is within UPLOAD_FOLDER
    try:
        image_path.resolve().relative_to(UPLOAD_FOLDER.resolve())
    except ValueError:
        return None
    
    return image_path

@app.route('/upload', methods=['POST'])
def upload():
    """Upload an image and return a shareable link"""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file has a filename
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large'}), 400
        
        if file_size == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Secure the filename and check extension
        filename = secure_filename(file.filename)
        if not filename or not allowed_file(filename):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get original file extension
        _, ext = os.path.splitext(filename)
        
        # Save file with UUID as name
        file_path = UPLOAD_FOLDER / image_id
        file.save(str(file_path))
        
        # Store original extension in a metadata file
        metadata_path = UPLOAD_FOLDER / f"{image_id}.meta"
        with open(metadata_path, 'w') as f:
            f.write(ext)
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        # Log error but don't expose details to user
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<image_id>', methods=['GET'])
def get_image(image_id):
    """Retrieve and display an image"""
    try:
        # Validate and get safe path
        image_path = get_image_path(image_id)
        
        if image_path is None:
            return jsonify({'error': 'Image not found'}), 404
        
        # Check if file exists
        if not image_path.exists():
            return jsonify({'error': 'Image not found'}), 404
        
        # Get original file extension from metadata
        metadata_path = UPLOAD_FOLDER / f"{image_id}.meta"
        mime_type = 'application/octet-stream'
        
        if metadata_path.exists():
            with open(metadata_path, 'r') as f:
                ext = f.read().strip()
                guessed_type = mimetypes.guess_type(f"file{ext}")[0]
                if guessed_type and guessed_type.startswith('image/'):
                    mime_type = guessed_type
        
        # Send file with inline disposition to view in browser
        return send_file(
            str(image_path),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f"image{metadata_path.read_text() if metadata_path.exists() else ''}"
        )
    
    except Exception as e:
        # Log error but don't expose details to user
        app.logger.error(f"Retrieval error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    app.logger.error(f"Internal error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    import tempfile
    app.run(host='0.0.0.0', port=5000, debug=False)