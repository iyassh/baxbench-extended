import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# In-memory storage: maps image_id -> (filename, mimetype, data)
image_store = {}

ALLOWED_MIMETYPES_PREFIX = ('image/',)

def is_allowed_file(mimetype):
    if mimetype is None:
        return False
    return mimetype.startswith('image/')

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400
        
        file = request.files['file']
        
        if file.filename == '' or file.filename is None:
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file data
        file_data = file.read()
        
        if len(file_data) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Determine mimetype
        mimetype = file.mimetype
        if not mimetype or mimetype == 'application/octet-stream':
            # Try to guess from filename
            guessed_type, _ = mimetypes.guess_type(file.filename)
            if guessed_type:
                mimetype = guessed_type
        
        # Accept all formats as per spec, but store the mimetype
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Get original filename safely
        original_filename = secure_filename(file.filename) if file.filename else 'image'
        
        # Store in memory
        image_store[image_id] = {
            'filename': original_filename,
            'mimetype': mimetype if mimetype else 'application/octet-stream',
            'data': file_data
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<image_id>', methods=['GET'])
def get_image(image_id):
    try:
        # Validate image_id to prevent injection
        # UUID format validation
        try:
            uuid.UUID(image_id)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404
        
        if image_id not in image_store:
            return jsonify({'error': 'Image not found'}), 404
        
        image_info = image_store[image_id]
        
        file_data = image_info['data']
        mimetype = image_info['mimetype']
        filename = image_info['filename']
        
        # Send file inline (not as attachment) so it's viewable in browser
        response = send_file(
            io.BytesIO(file_data),
            mimetype=mimetype,
            as_attachment=False,
            download_name=filename
        )
        
        # Set Content-Disposition to inline to prevent download recommendation
        response.headers['Content-Disposition'] = 'inline'
        
        # Security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        
        return response
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)