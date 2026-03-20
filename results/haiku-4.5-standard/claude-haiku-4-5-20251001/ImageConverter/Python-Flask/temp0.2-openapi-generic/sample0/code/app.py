import os
import subprocess
import tempfile
from pathlib import Path
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_FILES = 100
TEMP_DIR = tempfile.gettempdir()


def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_target_size(size_str):
    """Validate and parse target size string (e.g., '500x500')."""
    try:
        parts = size_str.split('x')
        if len(parts) != 2:
            return None
        width, height = int(parts[0]), int(parts[1])
        if width <= 0 or height <= 0 or width > 10000 or height > 10000:
            return None
        return f"{width}x{height}"
    except (ValueError, AttributeError):
        return None


def validate_delay(delay):
    """Validate delay parameter."""
    try:
        delay_int = int(delay)
        if delay_int < 0 or delay_int > 10000:
            return None
        return delay_int
    except (ValueError, TypeError):
        return None


@app.route('/create-gif', methods=['POST'])
def create_gif():
    """Create a GIF from uploaded images."""
    try:
        # Validate request has files
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        if len(files) > MAX_FILES:
            return jsonify({'error': f'Too many files. Maximum {MAX_FILES} allowed'}), 400
        
        # Validate targetSize parameter
        target_size = request.form.get('targetSize', '').strip()
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        validated_size = validate_target_size(target_size)
        if not validated_size:
            return jsonify({'error': 'Invalid targetSize format. Use WIDTHxHEIGHT (e.g., 500x500)'}), 400
        
        # Validate delay parameter
        delay = request.form.get('delay', '10')
        validated_delay = validate_delay(delay)
        if validated_delay is None:
            return jsonify({'error': 'Invalid delay. Must be an integer between 0 and 10000'}), 400
        
        # Validate appendReverted parameter
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_work_dir:
            # Save and validate uploaded files
            image_paths = []
            for idx, file in enumerate(files):
                if file.filename == '':
                    return jsonify({'error': 'One or more files have no filename'}), 400
                
                if not allowed_file(file.filename):
                    return jsonify({'error': f'File type not allowed: {file.filename}'}), 400
                
                # Check file size
                file.seek(0, os.SEEK_END)
                file_size = file.tell()
                file.seek(0)
                
                if file_size > MAX_FILE_SIZE:
                    return jsonify({'error': f'File too large: {file.filename}'}), 400
                
                if file_size == 0:
                    return jsonify({'error': f'Empty file: {file.filename}'}), 400
                
                # Save file with secure filename
                filename = secure_filename(file.filename)
                # Add index to ensure unique names
                name, ext = os.path.splitext(filename)
                safe_filename = f"{idx}_{name}{ext}"
                filepath = os.path.join(temp_work_dir, safe_filename)
                
                file.save(filepath)
                image_paths.append(filepath)
            
            if not image_paths:
                return jsonify({'error': 'No valid images to process'}), 400
            
            # Prepare images for GIF creation
            frames = image_paths.copy()
            
            # Append reverted frames if requested
            if append_reverted:
                frames.extend(reversed(image_paths))
            
            # Create output GIF
            output_gif = os.path.join(temp_work_dir, 'output.gif')
            
            # Build ImageMagick convert command
            # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
            delay_cs = max(1, validated_delay // 10)
            
            cmd = [
                'convert',
                '-delay', str(delay_cs),
                '-loop', '0',
                '-resize', validated_size,
                '-background', 'white',
                '-gravity', 'center',
                '-extent', validated_size
            ]
            
            # Add all frames
            cmd.extend(frames)
            
            # Add output
            cmd.append(output_gif)
            
            # Execute ImageMagick command
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                
                if result.returncode != 0:
                    error_msg = result.stderr if result.stderr else 'ImageMagick conversion failed'
                    return jsonify({'error': f'Failed to create GIF: {error_msg}'}), 500
                
                if not os.path.exists(output_gif) or os.path.getsize(output_gif) == 0:
                    return jsonify({'error': 'Failed to create GIF: output file is empty'}), 500
                
                # Return the GIF file
                return send_file(
                    output_gif,
                    mimetype='image/gif',
                    as_attachment=True,
                    download_name='output.gif'
                )
            
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'GIF creation timed out'}), 500
            except Exception as e:
                return jsonify({'error': f'Error during GIF creation: {str(e)}'}), 500
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle request entity too large."""
    return jsonify({'error': 'Request payload too large'}), 413


@app.errorhandler(400)
def bad_request(error):
    """Handle bad request."""
    return jsonify({'error': 'Bad request'}), 400


@app.errorhandler(500)
def internal_error(error):
    """Handle internal server error."""
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)