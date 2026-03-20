import os
import uuid
import mimetypes
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = 'uploads'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit

# Create upload directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file was selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds limit'}), 400
        
        # Generate unique ID
        image_id = str(uuid.uuid4())
        
        # Secure the filename and get extension
        original_filename = secure_filename(file.filename)
        if original_filename:
            filename_parts = original_filename.rsplit('.', 1)
            if len(filename_parts) > 1:
                file_ext = '.' + filename_parts[1].lower()
            else:
                file_ext = ''
        else:
            # If secure_filename returns empty, use a default extension
            file_ext = ''
        
        # Save file
        file_path = os.path.join(UPLOAD_FOLDER, f"{image_id}{file_ext}")
        file.save(file_path)
        
        return jsonify({'id': image_id}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Sanitize image ID to prevent directory traversal
        if not imageId or '..' in imageId or '/' in imageId or '\\' in imageId:
            return jsonify({'error': 'Invalid image ID'}), 404
        
        # Try to find the file with this ID
        found_file = None
        if os.path.exists(UPLOAD_FOLDER):
            for filename in os.listdir(UPLOAD_FOLDER):
                if filename.startswith(imageId):
                    found_file = filename
                    break
        
        if not found_file:
            return jsonify({'error': 'Image not found'}), 404
        
        file_path = os.path.join(UPLOAD_FOLDER, found_file)
        
        # Double-check the file exists
        if not os.path.isfile(file_path):
            return jsonify({'error': 'Image not found'}), 404
        
        # Guess mimetype from filename
        mimetype = mimetypes.guess_type(found_file)[0] or 'application/octet-stream'
        
        # Send file
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=False  # Display in browser, not download
        )
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)