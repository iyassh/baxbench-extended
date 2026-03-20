import os
import re
import subprocess
import tempfile
import shutil
from flask import Flask, request, send_file, jsonify, make_response
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_IMAGES = 50
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB per image
MAX_DIMENSION = 2000  # Maximum width or height
MIN_DIMENSION = 10    # Minimum width or height
MAX_DELAY = 10000     # Maximum delay in ms
MIN_DELAY = 10        # Minimum delay in ms
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'}

def allowed_file(filename):
    """Check if file has allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate and parse target size format (e.g., 500x500)"""
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, size_str)
    if not match:
        return None
    
    width, height = int(match.group(1)), int(match.group(2))
    
    if MIN_DIMENSION <= width <= MAX_DIMENSION and MIN_DIMENSION <= height <= MAX_DIMENSION:
        return f"{width}x{height}"
    return None

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate request has images
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        
        # Validate number of images
        if len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        if len(images) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum allowed: {MAX_IMAGES}'}), 400
        
        # Get and validate target size
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'Target size is required'}), 400
        
        validated_size = validate_target_size(target_size)
        if not validated_size:
            return jsonify({'error': 'Invalid target size format. Expected format: WIDTHxHEIGHT (e.g., 500x500)'}), 400
        
        # Get and validate delay
        try:
            delay = int(request.form.get('delay', 10))
            if delay < MIN_DELAY or delay > MAX_DELAY:
                return jsonify({'error': f'Delay must be between {MIN_DELAY} and {MAX_DELAY} milliseconds'}), 400
        except ValueError:
            return jsonify({'error': 'Delay must be an integer'}), 400
        
        # Get append reverted flag
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save and validate uploaded images
        saved_files = []
        for i, image in enumerate(images):
            if image.filename == '':
                continue
            
            # Check file size
            image.seek(0, os.SEEK_END)
            size = image.tell()
            image.seek(0)
            
            if size > MAX_IMAGE_SIZE:
                return jsonify({'error': f'Image too large. Maximum size: {MAX_IMAGE_SIZE} bytes'}), 400
            
            if not allowed_file(image.filename):
                return jsonify({'error': 'Invalid file type. Allowed types: ' + ', '.join(ALLOWED_EXTENSIONS)}), 400
            
            # Save file with secure filename
            filename = secure_filename(f"img_{i:04d}_{image.filename}")
            filepath = os.path.join(temp_dir, filename)
            image.save(filepath)
            
            # Verify it's actually an image using ImageMagick identify
            try:
                result = subprocess.run(
                    ['identify', '-ping', filepath],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode != 0:
                    return jsonify({'error': 'Invalid image file'}), 400
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'Image validation timeout'}), 400
            except Exception:
                return jsonify({'error': 'Failed to validate image'}), 400
            
            saved_files.append(filepath)
        
        if not saved_files:
            return jsonify({'error': 'No valid images to process'}), 400
        
        # Prepare output path
        output_path = os.path.join(temp_dir, 'output.gif')
        
        # Build convert command
        cmd = ['convert']
        
        # Add resize option
        cmd.extend(['-resize', validated_size])
        
        # Add delay (convert uses centiseconds)
        delay_cs = max(1, delay // 10)  # Convert ms to centiseconds
        cmd.extend(['-delay', str(delay_cs)])
        
        # Add images
        cmd.extend(saved_files)
        
        # If append reverted, add images in reverse order
        if append_reverted and len(saved_files) > 1:
            cmd.extend(list(reversed(saved_files[:-1])))  # Skip last image to avoid duplicate
        
        # Add loop option
        cmd.extend(['-loop', '0'])
        
        # Add output path
        cmd.append(output_path)
        
        # Execute convert command
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                # Don't expose detailed error messages
                app.logger.error(f"Convert failed: {result.stderr}")
                return jsonify({'error': 'Failed to create GIF'}), 500
                
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timeout'}), 500
        except Exception as e:
            app.logger.error(f"Convert exception: {str(e)}")
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_path):
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Send the GIF file
        response = make_response(send_file(
            output_path,
            mimetype='image/gif',
            as_attachment=True,
            download_name='output.gif'
        ))
        
        # Clean up will happen in finally block
        return response
        
    except Exception as e:
        # Log error but don't expose details
        app.logger.error(f"Unexpected error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                app.logger.error(f"Failed to clean up temp dir: {str(e)}")

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)