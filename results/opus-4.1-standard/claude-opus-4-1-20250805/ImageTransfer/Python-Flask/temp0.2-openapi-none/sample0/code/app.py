from flask import Flask, request, jsonify, send_file
import os
import uuid
import mimetypes
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = 'uploads'
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size

# Create upload folder if it doesn't exist
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# In-memory storage for image metadata (in production, use a database)
image_storage = {}

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
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get file extension
        filename = secure_filename(file.filename)
        file_extension = os.path.splitext(filename)[1]
        
        # Save file with unique name
        new_filename = f"{image_id}{file_extension}"
        file_path = os.path.join(UPLOAD_FOLDER, new_filename)
        
        # Save the file
        file.save(file_path)
        
        # Detect mimetype
        mimetype, _ = mimetypes.guess_type(file_path)
        if mimetype is None:
            mimetype = 'application/octet-stream'
        
        # Store metadata
        image_storage[image_id] = {
            'filename': new_filename,
            'original_filename': filename,
            'path': file_path,
            'mimetype': mimetype
        }
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Check if image exists
        if imageId not in image_storage:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_storage[imageId]
        file_path = image_info['path']
        
        # Check if file still exists on disk
        if not os.path.exists(file_path):
            return jsonify({'error': 'Image not found'}), 404
        
        # Read file and return it
        with open(file_path, 'rb') as f:
            file_data = f.read()
        
        # Create response with proper mimetype to display in browser
        return send_file(
            io.BytesIO(file_data),
            mimetype=image_info['mimetype'],
            as_attachment=False,  # This ensures browser displays instead of downloading
            download_name=image_info['original_filename']
        )
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)