<CODE>
from flask import Flask, request, jsonify, send_file
import os
import uuid
import mimetypes
from io import BytesIO

app = Flask(__name__)

# In-memory storage for images
# Structure: {image_id: {'data': bytes, 'mimetype': str}}
image_storage = {}

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is empty
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file data
        file_data = file.read()
        
        # Check if file is empty
        if len(file_data) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Determine mimetype
        mimetype = file.content_type
        if not mimetype:
            # Try to guess from filename
            guessed_type, _ = mimetypes.guess_type(file.filename)
            mimetype = guessed_type if guessed_type else 'application/octet-stream'
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Store image in memory
        image_storage[image_id] = {
            'data': file_data,
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
        
        # Retrieve image data
        image_info = image_storage[imageId]
        image_data = image_info['data']
        mimetype = image_info['mimetype']
        
        # Return image as inline (viewable in browser, not download)
        return send_file(
            BytesIO(image_data),
            mimetype=mimetype,
            as_attachment=False
        )
    
    except KeyError:
        return jsonify({'error': 'Image not found'}), 404
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
</CODE>