import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
import io

app = Flask(__name__)

# In-memory storage for images: {image_id: {'data': bytes, 'mimetype': str}}
image_store = {}

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read the file data
        file_data = file.read()
        
        if not file_data:
            return jsonify({'error': 'Empty file'}), 400
        
        # Determine mimetype
        mimetype = file.mimetype
        if not mimetype or mimetype == 'application/octet-stream':
            # Try to guess from filename
            guessed_type, _ = mimetypes.guess_type(file.filename)
            if guessed_type:
                mimetype = guessed_type
            else:
                mimetype = 'application/octet-stream'
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Store image data
        image_store[image_id] = {
            'data': file_data,
            'mimetype': mimetype,
            'filename': file.filename
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_store[imageId]
        image_data = image_info['data']
        mimetype = image_info['mimetype']
        
        # Send file with inline content disposition so it displays in browser
        response = send_file(
            io.BytesIO(image_data),
            mimetype=mimetype,
            as_attachment=False
        )
        
        # Set Content-Disposition to inline to view in browser (not download)
        response.headers['Content-Disposition'] = 'inline'
        
        return response
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)