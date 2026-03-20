from flask import Flask, request, jsonify, send_file
import os
import tempfile
import subprocess
import re
from werkzeug.utils import secure_filename
import uuid

app = Flask(__name__)

# Configure maximum file size (16MB)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(target_size):
    """Validate target size format (widthxheight)"""
    pattern = r'^\d+x\d+$'
    if not re.match(pattern, target_size):
        return False
    
    width, height = target_size.split('x')
    width, height = int(width), int(height)
    
    # Reasonable size limits
    if width < 1 or height < 1 or width > 4096 or height > 4096:
        return False
    
    return True

def sanitize_delay(delay):
    """Sanitize and validate delay parameter"""
    try:
        delay = int(delay)
        if delay < 1 or delay > 10000:  # Reasonable delay limits
            return 100  # Default value
        return delay
    except (ValueError, TypeError):
        return 100  # Default value

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if images are present
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Check if all files are valid
        for file in files:
            if file.filename == '':
                return jsonify({'error': 'Empty filename provided'}), 400
            if not allowed_file(file.filename):
                return jsonify({'error': f'Invalid file type: {file.filename}'}), 400
        
        # Get and validate target size
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        if not validate_target_size(target_size):
            return jsonify({'error': 'Invalid targetSize format. Use widthxheight (e.g., 500x500)'}), 400
        
        # Get and validate delay
        delay = request.form.get('delay', 100)
        delay = sanitize_delay(delay)
        
        # Get appendReverted flag
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            # Generate unique session ID to avoid conflicts
            session_id = str(uuid.uuid4())
            
            # Save uploaded files
            input_files = []
            for i, file in enumerate(files):
                filename = f"{session_id}_{i}_{secure_filename(file.filename)}"
                filepath = os.path.join(temp_dir, filename)
                file.save(filepath)
                input_files.append(filepath)
            
            # Prepare ImageMagick command
            output_gif = os.path.join(temp_dir, f"{session_id}_output.gif")
            
            # Build command arguments
            cmd = ['convert']
            
            # Add input files
            for input_file in input_files:
                cmd.append(input_file)
            
            # If append reverted, add reversed files
            if append_reverted:
                for input_file in reversed(input_files):
                    cmd.append(input_file)
            
            # Add ImageMagick options
            cmd.extend([
                '-resize', target_size,
                '-delay', str(delay // 10),  # ImageMagick uses centiseconds
                '-loop', '0',
                output_gif
            ])
            
            # Execute ImageMagick command
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.returncode != 0:
                    return jsonify({'error': f'Image processing failed: {result.stderr}'}), 500
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'Image processing timed out'}), 500
            except Exception as e:
                return jsonify({'error': f'Image processing error: {str(e)}'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_gif):
                return jsonify({'error': 'Failed to create GIF'}), 500
            
            # Return the GIF file
            return send_file(
                output_gif,
                mimetype='image/gif',
                as_attachment=True,
                download_name='animated.gif'
            )
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)