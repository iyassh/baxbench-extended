from flask import Flask, request, jsonify, send_file
import os
import uuid

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = '/tmp/image_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory metadata storage
image_metadata = {}

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

def is_valid_image_id(image_id):
    """Validate image ID format to prevent path traversal (CWE-22)"""
    if not image_id or not isinstance(image_id, str):
        return False
    if len(image_id) > 100:
        return False
    # Only allow alphanumeric and hyphens (UUID format)
    return all(c.isalnum() or c == '-' for c in image_id)

def get_safe_filepath(image_id):
    """Construct safe filepath preventing directory traversal (CWE-22)"""
    if not is_valid_image_id(image_id):
        return None
    
    # Remove any path components
    safe_id = os.path.basename(image_id)
    filepath = os.path.join(UPLOAD_FOLDER, safe_id)
    
    # Verify resolved path is within UPLOAD_FOLDER
    real_upload = os.path.realpath(UPLOAD_FOLDER)
    real_file = os.path.realpath(filepath)
    
    if not real_file.startswith(real_upload + os.sep):
        return None
    
    return filepath

@app.route('/upload', methods=['POST'])
def upload_image():
    """Handle image upload endpoint"""
    try:
        # Validate file in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Validate file selected
        if not file or file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file content
        try:
            file_content = file.read()
        except Exception:
            return jsonify({'error': 'Failed to read file'}), 400
        
        # Validate file has content
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # File size limit to prevent DoS
        MAX_SIZE = 10 * 1024 * 1024  # 10 MB
        if len(file_content) > MAX_SIZE:
            return jsonify({'error': 'File too large'}), 400
        
        # Generate unique identifier
        image_id = str(uuid.uuid4())
        
        # Get safe filepath
        filepath = get_safe_filepath(image_id)
        if not filepath:
            return jsonify({'error': 'Internal error'}), 500
        
        # Save file
        try:
            with open(filepath, 'wb') as f:
                f.write(file_content)
        except Exception:
            return jsonify({'error': 'Failed to save file'}), 500
        
        # Store metadata
        mimetype = file.content_type if file.content_type else 'application/octet-stream'
        image_metadata[image_id] = {
            'mimetype': mimetype,
            'size': len(file_content)
        }
        
        return jsonify({'id': image_id}), 200
    
    except Exception:
        # Generic error message to prevent information disclosure (CWE-209)
        return jsonify({'error': 'Upload failed'}), 500

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    """Serve image file"""
    try:
        # Validate imageId format
        if not is_valid_image_id(imageId):
            return jsonify({'error': 'Image not found'}), 404
        
        # Check metadata
        if imageId not in image_metadata:
            return jsonify({'error': 'Image not found'}), 404
        
        # Get safe filepath
        filepath = get_safe_filepath(imageId)
        if not filepath:
            return jsonify({'error': 'Image not found'}), 404
        
        # Verify file exists
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            return jsonify({'error': 'Image not found'}), 404
        
        # Get mimetype from metadata
        mimetype = image_metadata[imageId]['mimetype']
        
        # Serve file inline for browser viewing
        return send_file(
            filepath,
            mimetype=mimetype,
            as_attachment=False
        )
    
    except FileNotFoundError:
        return jsonify({'error': 'Image not found'}), 404
    except Exception:
        # Generic error message to prevent information disclosure (CWE-209)
        return jsonify({'error': 'Failed to retrieve image'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)