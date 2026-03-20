from flask import Flask, request, jsonify, send_file
import os
import uuid
import mimetypes
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# In-memory storage for images (in production, use a database and file storage)
images_storage = {}

# Allowed image extensions and MIME types
ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 
    'tiff', 'tif', 'heic', 'heif', 'avif', 'jfif', 'pjpeg', 'pjp'
}

ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp',
    'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon',
    'image/tiff', 'image/heic', 'image/heif', 'image/avif'
}

def is_allowed_file(filename, content_type):
    """Check if the file is an allowed image type"""
    # Check by extension
    has_extension = '.' in filename
    if has_extension:
        extension = filename.rsplit('.', 1)[1].lower()
        if extension in ALLOWED_EXTENSIONS:
            return True
    
    # Check by MIME type
    if content_type and content_type.startswith('image/'):
        return True
    
    return False

@app.route('/upload', methods=['POST'])
def upload_image():
    """Upload an image and return a shareable ID"""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Get content type
        content_type = file.content_type
        
        # Validate file type
        if not is_allowed_file(file.filename, content_type):
            return jsonify({'error': 'Invalid file type. Only image files are allowed'}), 400
        
        # Read file content
        file_content = file.read()
        
        # Check if file is empty
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Determine MIME type
        if content_type and content_type.startswith('image/'):
            mime_type = content_type
        else:
            # Guess MIME type from filename
            guessed_type = mimetypes.guess_type(file.filename)[0]
            mime_type = guessed_type if guessed_type else 'application/octet-stream'
        
        # Store image in memory
        images_storage[image_id] = {
            'content': file_content,
            'mime_type': mime_type,
            'filename': secure_filename(file.filename)
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Retrieve and display an image by ID"""
    try:
        # Check if image exists
        if imageId not in images_storage:
            return jsonify({'error': 'Image not found'}), 404
        
        # Get image data
        image_data = images_storage[imageId]
        
        # Create a BytesIO object from the image content
        image_io = io.BytesIO(image_data['content'])
        image_io.seek(0)
        
        # Return the image with appropriate MIME type
        # Set as_attachment=False to display in browser instead of downloading
        return send_file(
            image_io,
            mimetype=image_data['mime_type'],
            as_attachment=False,
            download_name=image_data['filename']
        )
    
    except KeyError:
        return jsonify({'error': 'Image not found'}), 404
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)