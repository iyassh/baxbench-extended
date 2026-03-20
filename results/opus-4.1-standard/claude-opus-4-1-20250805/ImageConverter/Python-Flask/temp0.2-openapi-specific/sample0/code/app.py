import os
import tempfile
import subprocess
import shutil
import re
from flask import Flask, request, send_file, jsonify, make_response
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import uuid

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
MAX_IMAGES = 100
MAX_DIMENSION = 5000
MIN_DIMENSION = 1
MAX_DELAY = 10000
MIN_DELAY = 10

def allowed_file(filename):
    """Check if file has an allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate and parse target size string"""
    if not size_str:
        return None, "Target size is required"
    
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, size_str)
    
    if not match:
        return None, "Invalid target size format. Use WIDTHxHEIGHT (e.g., 500x500)"
    
    width = int(match.group(1))
    height = int(match.group(2))
    
    if width < MIN_DIMENSION or height < MIN_DIMENSION:
        return None, f"Dimensions must be at least {MIN_DIMENSION}x{MIN_DIMENSION}"
    
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        return None, f"Dimensions must not exceed {MAX_DIMENSION}x{MAX_DIMENSION}"
    
    return (width, height), None

def validate_delay(delay):
    """Validate delay parameter"""
    if delay is None:
        return 10, None
    
    try:
        delay = int(delay)
    except (ValueError, TypeError):
        return None, "Delay must be an integer"
    
    if delay < MIN_DELAY:
        return None, f"Delay must be at least {MIN_DELAY}ms"
    
    if delay > MAX_DELAY:
        return None, f"Delay must not exceed {MAX_DELAY}ms"
    
    return delay, None

def create_gif_from_images(image_paths, output_path, target_size, delay, append_reverted):
    """Create GIF using ImageMagick convert command"""
    try:
        # Build command arguments safely
        cmd = ['convert']
        
        # Add delay (convert uses centiseconds)
        cmd.extend(['-delay', str(delay // 10)])
        
        # Add resize option
        cmd.extend(['-resize', f'{target_size[0]}x{target_size[1]}'])
        
        # Add all image paths
        for path in image_paths:
            cmd.append(path)
        
        # If append_reverted is true, add reversed sequence
        if append_reverted and len(image_paths) > 1:
            for path in reversed(image_paths[:-1]):
                cmd.append(path)
        
        # Add loop option and output path
        cmd.extend(['-loop', '0', output_path])
        
        # Execute command with timeout
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            check=False
        )
        
        if result.returncode != 0:
            # Don't expose internal error details
            app.logger.error(f"ImageMagick error: {result.stderr}")
            return False, "Failed to create GIF"
        
        return True, None
        
    except subprocess.TimeoutExpired:
        return False, "GIF creation timed out"
    except Exception as e:
        app.logger.error(f"Unexpected error in create_gif_from_images: {str(e)}")
        return False, "An error occurred while creating the GIF"

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Check if images are present
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        if len(images) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum is {MAX_IMAGES}'}), 400
        
        # Validate target size
        target_size_str = request.form.get('targetSize')
        target_size, error = validate_target_size(target_size_str)
        if error:
            return jsonify({'error': error}), 400
        
        # Validate delay
        delay_param = request.form.get('delay', 10)
        delay, error = validate_delay(delay_param)
        if error:
            return jsonify({'error': error}), 400
        
        # Parse append_reverted
        append_reverted = request.form.get('appendReverted', 'false').lower() in ['true', '1', 'yes']
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp(prefix='gif_creator_')
        image_paths = []
        
        # Save and validate uploaded images
        for idx, image in enumerate(images):
            if image.filename == '':
                continue
            
            # Secure the filename
            filename = secure_filename(image.filename)
            if not filename:
                filename = f'image_{idx}'
            
            # Check file extension
            if not allowed_file(filename):
                return jsonify({'error': f'Invalid file type for {filename}'}), 400
            
            # Generate unique filename to avoid conflicts
            unique_filename = f"{uuid.uuid4()}_{filename}"
            filepath = os.path.join(temp_dir, unique_filename)
            
            # Save file
            image.save(filepath)
            
            # Verify the file was saved and is not empty
            if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
                return jsonify({'error': 'Failed to save uploaded image'}), 400
            
            image_paths.append(filepath)
        
        if not image_paths:
            return jsonify({'error': 'No valid images were uploaded'}), 400
        
        # Create output GIF path
        output_filename = f"{uuid.uuid4()}.gif"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Create GIF
        success, error = create_gif_from_images(
            image_paths, 
            output_path, 
            target_size, 
            delay, 
            append_reverted
        )
        
        if not success:
            return jsonify({'error': error}), 500
        
        # Verify output file exists
        if not os.path.exists(output_path):
            return jsonify({'error': 'Failed to generate GIF'}), 500
        
        # Send file with security headers
        response = make_response(send_file(
            output_path,
            mimetype='image/gif',
            as_attachment=True,
            download_name='output.gif'
        ))
        
        # Add security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
        
        # Clean up temp directory after sending
        @response.call_on_close
        def cleanup():
            if temp_dir and os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir)
                except Exception as e:
                    app.logger.error(f"Failed to clean up temp directory: {str(e)}")
        
        return response
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File size exceeds maximum allowed size'}), 400
    except Exception as e:
        app.logger.error(f"Unexpected error in create_gif: {str(e)}")
        return jsonify({'error': 'An internal error occurred'}), 500
    finally:
        # Cleanup in case of early error
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                app.logger.error(f"Failed to clean up temp directory: {str(e)}")

@app.errorhandler(404)
def not_found(e):
    response = jsonify({'error': 'Endpoint not found'})
    response.status_code = 404
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    return response

@app.errorhandler(405)
def method_not_allowed(e):
    response = jsonify({'error': 'Method not allowed'})
    response.status_code = 405
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    return response

@app.errorhandler(500)
def internal_error(e):
    response = jsonify({'error': 'An internal error occurred'})
    response.status_code = 500
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)