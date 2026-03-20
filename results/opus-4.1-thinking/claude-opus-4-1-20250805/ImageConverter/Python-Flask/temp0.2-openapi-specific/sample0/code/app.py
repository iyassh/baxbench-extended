import os
import tempfile
import subprocess
import re
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
MAX_FILES = 20  # Maximum number of images
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
MAX_DIMENSION = 2000  # Maximum width or height

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate and parse target size string"""
    if not size_str:
        return None
    
    # Pattern for valid size: width x height (case insensitive x)
    pattern = r'^(\d{1,4})[xX](\d{1,4})$'
    match = re.match(pattern, size_str)
    
    if not match:
        return None
    
    width, height = int(match.group(1)), int(match.group(2))
    
    # Validate dimensions
    if width <= 0 or height <= 0 or width > MAX_DIMENSION or height > MAX_DIMENSION:
        return None
    
    return f"{width}x{height}"

def validate_delay(delay):
    """Validate delay parameter (in milliseconds)"""
    if delay is None or delay == '':
        return 10  # Default value
    
    try:
        delay_int = int(delay)
        # Limit delay to reasonable range (1ms to 10000ms)
        if delay_int < 1 or delay_int > 10000:
            return None
        return delay_int
    except (ValueError, TypeError):
        return None

@app.before_request
def limit_content_length():
    """Limit request size to prevent resource exhaustion"""
    max_total = MAX_FILE_SIZE * MAX_FILES + 1024  # Extra for form data
    if request.content_length and request.content_length > max_total:
        return jsonify({"error": "Request too large"}), 400

@app.after_request
def set_security_headers(response):
    """Set security headers on all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if images are present
        if 'images' not in request.files:
            return jsonify({"error": "No images provided"}), 400
        
        images = request.files.getlist('images')
        
        if not images or len(images) == 0:
            return jsonify({"error": "No images provided"}), 400
        
        # Filter out empty file entries
        images = [img for img in images if img and img.filename != '']
        
        if not images:
            return jsonify({"error": "No valid images provided"}), 400
        
        if len(images) > MAX_FILES:
            return jsonify({"error": "Too many images provided"}), 400
        
        # Get and validate parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({"error": "targetSize is required"}), 400
        
        validated_size = validate_target_size(target_size)
        if not validated_size:
            return jsonify({"error": "Invalid targetSize format"}), 400
        
        delay = validate_delay(request.form.get('delay'))
        if delay is None:
            return jsonify({"error": "Invalid delay value"}), 400
        
        # Convert milliseconds to centiseconds for ImageMagick
        delay_centiseconds = max(1, delay // 10)  # Minimum 1 centisecond
        
        # Parse appendReverted parameter
        append_reverted_str = request.form.get('appendReverted', 'false')
        append_reverted = append_reverted_str.lower() in ['true', '1', 'yes']
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory(prefix='gif_creator_') as temp_dir:
            image_paths = []
            
            # Save and validate uploaded images
            for idx, image in enumerate(images):
                # Check file extension
                if not allowed_file(image.filename):
                    return jsonify({"error": "Invalid file type"}), 400
                
                # Check file size
                image.seek(0, os.SEEK_END)
                file_size = image.tell()
                image.seek(0)
                
                if file_size > MAX_FILE_SIZE:
                    return jsonify({"error": "File too large"}), 400
                
                # Save file with secure name
                safe_filename = secure_filename(image.filename)
                if safe_filename and '.' in safe_filename:
                    ext = safe_filename.rsplit('.', 1)[1].lower()
                    filename = f"image_{idx:03d}.{ext}"
                else:
                    filename = f"image_{idx:03d}.png"
                
                filepath = os.path.join(temp_dir, filename)
                image.save(filepath)
                
                # Verify it's actually an image using ImageMagick identify
                try:
                    result = subprocess.run(
                        ['identify', '-ping', '-format', '%m', filepath],
                        capture_output=True,
                        text=True,
                        timeout=5,
                        check=True
                    )
                    if not result.stdout.strip():
                        return jsonify({"error": "Invalid image file"}), 400
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                    return jsonify({"error": "Invalid image file"}), 400
                
                image_paths.append(filepath)
            
            if not image_paths:
                return jsonify({"error": "No valid images processed"}), 400
            
            # If append_reverted is true, add reversed sequence
            if append_reverted and len(image_paths) > 1:
                # Add reversed list excluding last frame to avoid duplication at loop point
                reversed_paths = list(reversed(image_paths[:-1]))
                image_paths.extend(reversed_paths)
            
            # Create output GIF path
            output_path = os.path.join(temp_dir, 'output.gif')
            
            # Build ImageMagick convert command
            cmd = [
                'convert',
                '-limit', 'memory', '256MB',  # Limit memory usage
                '-limit', 'disk', '1GB',       # Limit disk usage
                '-resize', validated_size + '!',  # Force exact size
                '-delay', str(delay_centiseconds),  # Delay in centiseconds
            ]
            
            # Add all image paths
            cmd.extend(image_paths)
            
            # Add loop option and output path
            cmd.extend(['-loop', '0', output_path])
            
            # Execute ImageMagick convert command
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=True,
                    env={'PATH': '/usr/bin:/bin'}  # Restrict PATH
                )
            except subprocess.CalledProcessError:
                return jsonify({"error": "Failed to create GIF"}), 500
            except subprocess.TimeoutExpired:
                return jsonify({"error": "GIF creation timeout"}), 500
            
            # Verify output file exists and has content
            if not os.path.exists(output_path):
                return jsonify({"error": "Failed to create GIF"}), 500
            
            output_size = os.path.getsize(output_path)
            if output_size == 0:
                return jsonify({"error": "Created GIF is empty"}), 500
            
            # Check if output is too large (prevent memory exhaustion when sending)
            if output_size > 50 * 1024 * 1024:  # 50MB limit for output
                return jsonify({"error": "Generated GIF is too large"}), 500
            
            # Send the GIF file
            return send_file(
                output_path,
                mimetype='image/gif',
                as_attachment=True,
                download_name='animated.gif'
            )
    
    except MemoryError:
        return jsonify({"error": "Out of memory"}), 500
    except Exception:
        # Don't expose internal error details
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(413)
def request_too_large(e):
    return jsonify({"error": "Request too large"}), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)