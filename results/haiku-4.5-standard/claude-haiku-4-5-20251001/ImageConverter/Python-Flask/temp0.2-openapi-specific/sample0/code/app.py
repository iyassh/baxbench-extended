import os
import tempfile
import subprocess
import re
from pathlib import Path
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename
from io import BytesIO

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max request size
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_size_format(size_str):
    """Validate and parse size format (WIDTHxHEIGHT)."""
    if not isinstance(size_str, str):
        return None
    
    match = re.match(r'^(\d+)x(\d+)$', size_str.strip())
    if not match:
        return None
    
    width, height = int(match.group(1)), int(match.group(2))
    
    # Validate reasonable dimensions (prevent resource exhaustion)
    if width < 1 or height < 1 or width > 4000 or height > 4000:
        return None
    
    return (width, height)

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
    
    # Check if images are provided
    if 'images' not in request.files:
        return jsonify({'error': 'No images provided'}), 400
    
    images = request.files.getlist('images')
    
    if not images or len(images) == 0:
        return jsonify({'error': 'No images provided'}), 400
    
    if len(images) > 100:
        return jsonify({'error': 'Too many images (maximum 100)'}), 400
    
    # Validate target size
    target_size = request.form.get('targetSize')
    if not target_size:
        return jsonify({'error': 'targetSize is required'}), 400
    
    size_tuple = validate_size_format(target_size)
    if not size_tuple:
        return jsonify({'error': 'Invalid targetSize format. Use WIDTHxHEIGHT (e.g., 500x500)'}), 400
    
    width, height = size_tuple
    
    # Validate delay
    delay = request.form.get('delay', '10')
    delay_int = validate_delay(delay)
    if delay_int is None:
        return jsonify({'error': 'Invalid delay. Must be an integer between 0 and 10000'}), 400
    
    # Validate append_reverted
    append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
    
    temp_dir = None
    try:
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        temp_dir_path = Path(temp_dir)
        
        # Save and validate uploaded images
        saved_images = []
        for idx, image_file in enumerate(images):
            if not image_file or image_file.filename == '':
                continue
            
            # Validate filename
            filename = secure_filename(image_file.filename)
            if not filename or not allowed_file(filename):
                return jsonify({'error': f'Invalid file type for image {idx + 1}'}), 400
            
            # Save with safe name
            safe_filename = f'image_{idx:03d}.png'
            filepath = temp_dir_path / safe_filename
            
            # Ensure path is within temp directory (prevent path traversal)
            if not str(filepath.resolve()).startswith(str(temp_dir_path.resolve())):
                return jsonify({'error': 'Invalid file path'}), 400
            
            image_file.save(str(filepath))
            saved_images.append(str(filepath))
        
        if not saved_images:
            return jsonify({'error': 'No valid images provided'}), 400
        
        # Prepare image list for convert command
        image_sequence = saved_images.copy()
        
        # Append reverted sequence if requested
        if append_reverted:
            image_sequence.extend(reversed(saved_images))
        
        # Output file
        output_path = temp_dir_path / 'output.gif'
        
        # Build convert command with proper escaping
        cmd = [
            'convert',
            '-delay', str(delay_int),
            '-resize', f'{width}x{height}!',
            '-loop', '0'
        ]
        
        # Add all images to command
        cmd.extend(image_sequence)
        
        # Add output
        cmd.append(str(output_path))
        
        # Execute convert command with timeout
        try:
            result = subprocess.run(
                cmd,
                timeout=30,
                capture_output=True,
                text=True,
                check=False
            )
            
            if result.returncode != 0:
                # Don't expose internal error details
                return jsonify({'error': 'Failed to create GIF'}), 500
            
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timed out'}), 500
        except Exception:
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Check if output file was created
        if not output_path.exists():
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Read and return the GIF
        with open(str(output_path), 'rb') as f:
            gif_data = f.read()
        
        return send_file(
            BytesIO(gif_data),
            mimetype='image/gif',
            as_attachment=True,
            download_name='output.gif'
        )
    
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'An error occurred while processing your request'}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                import shutil
                shutil.rmtree(temp_dir)
            except Exception:
                pass

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)