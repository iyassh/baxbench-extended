from flask import Flask, request, jsonify, send_file
import os
import tempfile
import subprocess
import re
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB max per file
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
MAX_IMAGES = 100  # Maximum number of images allowed

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate target size format (e.g., '500x500')"""
    pattern = r'^\d+x\d+$'
    if not re.match(pattern, size_str):
        return False
    width, height = map(int, size_str.split('x'))
    # Reasonable limits to prevent abuse
    if width < 1 or width > 5000 or height < 1 or height > 5000:
        return False
    return True

def validate_delay(delay):
    """Validate delay parameter"""
    try:
        delay_int = int(delay)
        # Reasonable limits: 10ms to 10 seconds
        if delay_int < 10 or delay_int > 10000:
            return False
        return True
    except (ValueError, TypeError):
        return False

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate request has files
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get all uploaded files
        files = request.files.getlist('images')
        
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        if len(files) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum allowed: {MAX_IMAGES}'}), 400
        
        # Get and validate parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        if not validate_target_size(target_size):
            return jsonify({'error': 'Invalid targetSize format. Use format like "500x500"'}), 400
        
        delay = request.form.get('delay', '10')
        if not validate_delay(delay):
            return jsonify({'error': 'Invalid delay. Must be between 10 and 10000 milliseconds'}), 400
        
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            image_paths = []
            
            # Save and validate uploaded files
            for idx, file in enumerate(files):
                if file.filename == '':
                    return jsonify({'error': f'Empty filename for image {idx + 1}'}), 400
                
                if not allowed_file(file.filename):
                    return jsonify({'error': f'Invalid file type for {file.filename}. Allowed types: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
                
                # Check file size
                file.seek(0, os.SEEK_END)
                file_size = file.tell()
                file.seek(0)
                
                if file_size > MAX_FILE_SIZE:
                    return jsonify({'error': f'File {file.filename} exceeds maximum size of {MAX_FILE_SIZE} bytes'}), 400
                
                # Save file with secure filename
                filename = secure_filename(f"{idx:04d}_{file.filename}")
                filepath = os.path.join(temp_dir, filename)
                file.save(filepath)
                image_paths.append(filepath)
            
            # Prepare output GIF path
            output_path = os.path.join(temp_dir, 'output.gif')
            
            # Build ImageMagick convert command
            cmd = ['convert']
            
            # Add delay (convert expects centiseconds)
            delay_cs = int(delay) // 10
            cmd.extend(['-delay', str(delay_cs)])
            
            # Add resize option
            cmd.extend(['-resize', target_size])
            
            # Add all images
            cmd.extend(image_paths)
            
            # If append_reverted is true, add images in reverse order
            if append_reverted and len(image_paths) > 1:
                cmd.extend(reversed(image_paths[:-1]))  # Exclude last image to avoid duplication
            
            # Add output path
            cmd.append(output_path)
            
            # Execute convert command
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                
                if result.returncode != 0:
                    error_msg = result.stderr if result.stderr else 'Unknown error during GIF creation'
                    return jsonify({'error': f'Failed to create GIF: {error_msg}'}), 500
                
                # Check if output file was created
                if not os.path.exists(output_path):
                    return jsonify({'error': 'GIF creation failed - output file not created'}), 500
                
                # Return the GIF file
                return send_file(output_path, mimetype='image/gif', as_attachment=True, download_name='output.gif')
                
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'GIF creation timed out'}), 500
            except Exception as e:
                return jsonify({'error': f'Error during GIF creation: {str(e)}'}), 500
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request entity too large'}), 413

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Set max content length to prevent very large uploads
    app.config['MAX_CONTENT_LENGTH'] = MAX_IMAGES * MAX_FILE_SIZE
    app.run(host='0.0.0.0', port=5000, debug=False)