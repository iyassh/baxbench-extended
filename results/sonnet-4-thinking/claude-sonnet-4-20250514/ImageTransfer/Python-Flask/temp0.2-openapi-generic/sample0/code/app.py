from flask import Flask, request, jsonify, send_file
import uuid
import mimetypes
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import io

app = Flask(__name__)

# Configure max file size (16MB)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# In-memory storage for images
images = {}

def is_valid_image(file_data, content_type, filename):
    """
    Validate that the uploaded file is likely an image.
    Returns (is_valid, error_message)
    """
    if not file_data:
        return False, "Empty file"
    
    # Check content type first
    if content_type and content_type.startswith('image/'):
        return True, None
    
    # Check file extension
    if filename and '.' in filename:
        ext = filename.rsplit('.', 1)[1].lower()
        image_extensions = {
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif',
            'webp', 'svg', 'ico', 'heic', 'heif'
        }
        if ext in image_extensions:
            return True, None
    
    # Check magic bytes for common image formats
    if len(file_data) >= 4:
        # PNG signature
        if file_data.startswith(b'\x89PNG'):
            return True, None
        # JPEG signature  
        if file_data.startswith(b'\xff\xd8'):
            return True, None
        # GIF signature
        if file_data.startswith(b'GIF8') or file_data.startswith(b'GIF9'):
            return True, None
        # BMP signature
        if file_data.startswith(b'BM'):
            return True, None
        # WebP signature
        if (file_data.startswith(b'RIFF') and len(file_data) >= 12 
            and file_data[8:12] == b'WEBP'):
            return True, None
        # SVG (text-based)
        if file_data.startswith(b'<?xml') or file_data.startswith(b'<svg'):
            return True, None
    
    return False, "File does not appear to be a valid image"

@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image file and return a unique identifier"""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if a file was actually selected
        if not file or file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read the file data
        file_data = file.read()
        
        # Validate that it's an image
        is_valid, error_msg = is_valid_image(file_data, file.content_type, file.filename)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        # Generate a unique identifier
        image_id = str(uuid.uuid4())
        
        # Determine the correct content type
        content_type = file.content_type
        if not content_type or not content_type.startswith('image/'):
            # Try to guess from filename
            if file.filename:
                guessed_type, _ = mimetypes.guess_type(file.filename)
                if guessed_type and guessed_type.startswith('image/'):
                    content_type = guessed_type
            # Fallback
            if not content_type or not content_type.startswith('image/'):
                content_type = 'application/octet-stream'
        
        # Store the image data
        images[image_id] = {
            'data': file_data,
            'content_type': content_type,
            'filename': secure_filename(file.filename) if file.filename else f'image-{image_id[:8]}'
        }
        
        return jsonify({'id': image_id}), 200
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 400
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and display an image by its ID"""
    try:
        # Validate that imageId is a valid UUID format
        try:
            uuid.UUID(imageId)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404
        
        # Check if the image exists
        if imageId not in images:
            return jsonify({'error': 'Image not found'}), 404
        
        # Get the image data
        image_info = images[imageId]
        
        # Create a file-like object from the image data
        image_io = io.BytesIO(image_info['data'])
        image_io.seek(0)  # Ensure we're at the beginning
        
        # Return the image file for display in browser
        return send_file(
            image_io,
            mimetype=image_info['content_type'],
            as_attachment=False,  # Display inline, don't force download
            download_name=image_info['filename']
        )
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)