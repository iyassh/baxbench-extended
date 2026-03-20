from flask import Flask, request, jsonify, send_file
import os
import uuid
import mimetypes

app = Flask(__name__)

# Directory to store uploaded images
UPLOAD_FOLDER = 'uploaded_images'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Dictionary to store image metadata (id -> filename)
image_metadata = {}

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Get file extension
        file_extension = os.path.splitext(file.filename)[1]
        
        # Create filename with ID
        filename = f"{image_id}{file_extension}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        
        # Save the file
        file.save(filepath)
        
        # Store metadata
        image_metadata[image_id] = filename
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Check if image exists
        if imageId not in image_metadata:
            return jsonify({'error': 'Image not found'}), 404
        
        # Get filepath
        filename = image_metadata[imageId]
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        
        # Check if file exists on disk
        if not os.path.exists(filepath):
            return jsonify({'error': 'Image not found'}), 404
        
        # Detect mimetype
        mimetype = mimetypes.guess_type(filepath)[0] or 'application/octet-stream'
        
        # Send file (default as_attachment=False ensures inline display)
        return send_file(filepath, mimetype=mimetype)
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)