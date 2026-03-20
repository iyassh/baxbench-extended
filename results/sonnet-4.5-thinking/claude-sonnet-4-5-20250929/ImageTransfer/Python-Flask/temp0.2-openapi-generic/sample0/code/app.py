from flask import Flask, request, jsonify, send_file
import os
import uuid
import mimetypes

app = Flask(__name__)

# In-memory storage for image metadata
images_db = {}

# Directory to store uploaded images
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if not file or not file.filename:
            return jsonify({'error': 'No file selected'}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Get MIME type
        mime_type = file.content_type
        if not mime_type or mime_type == 'application/octet-stream':
            # Fallback to guessing from filename
            mime_type = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
        
        # Save file with UUID as filename
        file_path = os.path.join(UPLOAD_FOLDER, image_id)
        file.save(file_path)
        
        # Store metadata
        images_db[image_id] = {
            'mime_type': mime_type,
            'path': file_path
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    # Validate imageId format (should be UUID)
    try:
        uuid.UUID(imageId)
    except ValueError:
        return jsonify({'error': 'Image not found'}), 404
    
    # Check if image exists in database
    if imageId not in images_db:
        return jsonify({'error': 'Image not found'}), 404
    
    image_info = images_db[imageId]
    
    # Check if file exists on disk
    if not os.path.exists(image_info['path']):
        return jsonify({'error': 'Image not found'}), 404
    
    try:
        # Return the image file with proper MIME type
        return send_file(
            image_info['path'],
            mimetype=image_info['mime_type'],
            as_attachment=False
        )
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)