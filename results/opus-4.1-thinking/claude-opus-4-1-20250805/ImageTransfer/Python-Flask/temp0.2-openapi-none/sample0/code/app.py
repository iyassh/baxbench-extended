from flask import Flask, request, jsonify, send_file
import os
import uuid
import json
from werkzeug.utils import secure_filename
import mimetypes

app = Flask(__name__)

# Directory to store uploaded images
UPLOAD_FOLDER = 'uploads'
METADATA_FOLDER = 'metadata'

# Ensure directories exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(METADATA_FOLDER, exist_ok=True)

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in the request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file was actually selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Get file extension and mimetype
        filename = secure_filename(file.filename)
        file_ext = os.path.splitext(filename)[1]
        
        # Detect mimetype
        mimetype = file.mimetype
        if not mimetype or mimetype == 'application/octet-stream':
            mimetype = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        
        # Save the file
        file_path = os.path.join(UPLOAD_FOLDER, f"{image_id}{file_ext}")
        file.save(file_path)
        
        # Save metadata
        metadata = {
            'original_filename': filename,
            'mimetype': mimetype,
            'file_extension': file_ext
        }
        metadata_path = os.path.join(METADATA_FOLDER, f"{image_id}.json")
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f)
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Validate UUID format
        try:
            uuid.UUID(imageId)
        except ValueError:
            return jsonify({'error': 'Invalid image ID format'}), 404
        
        # Load metadata
        metadata_path = os.path.join(METADATA_FOLDER, f"{imageId}.json")
        if not os.path.exists(metadata_path):
            return jsonify({'error': 'Image not found'}), 404
        
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        # Find the image file
        file_ext = metadata['file_extension']
        file_path = os.path.join(UPLOAD_FOLDER, f"{imageId}{file_ext}")
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'Image file not found'}), 404
        
        # Send file with proper mimetype and ensure it's viewable in browser
        return send_file(
            file_path,
            mimetype=metadata['mimetype'],
            as_attachment=False
        )
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)