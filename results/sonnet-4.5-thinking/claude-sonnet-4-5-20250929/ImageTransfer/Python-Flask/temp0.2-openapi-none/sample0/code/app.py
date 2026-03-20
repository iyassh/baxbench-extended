from flask import Flask, request, jsonify, send_file
import os
import uuid
import mimetypes
import json
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Directory to store uploaded images
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def get_metadata_path(image_id):
    return os.path.join(UPLOAD_FOLDER, f"{image_id}.meta")

def get_image_path(image_id):
    return os.path.join(UPLOAD_FOLDER, image_id)

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in request'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Generate unique ID for the image
        image_id = str(uuid.uuid4())
        
        # Get the file extension and mimetype
        filename = secure_filename(file.filename)
        mimetype = file.content_type or mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        
        # Save the file
        file_path = get_image_path(image_id)
        file.save(file_path)
        
        # Save metadata
        metadata = {
            'filename': filename,
            'mimetype': mimetype
        }
        with open(get_metadata_path(image_id), 'w') as f:
            json.dump(metadata, f)
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        file_path = get_image_path(imageId)
        metadata_path = get_metadata_path(imageId)
        
        # Check if file exists
        if not os.path.exists(file_path) or not os.path.exists(metadata_path):
            return jsonify({'error': 'Image not found'}), 404
        
        # Load metadata
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        mimetype = metadata['mimetype']
        
        # Return the image file with proper mimetype
        # as_attachment=False ensures it's displayed in browser, not downloaded
        return send_file(file_path, mimetype=mimetype, as_attachment=False)
    
    except FileNotFoundError:
        return jsonify({'error': 'Image not found'}), 404
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)