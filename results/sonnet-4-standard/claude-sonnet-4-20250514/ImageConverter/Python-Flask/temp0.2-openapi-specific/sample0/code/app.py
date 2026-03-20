from flask import Flask, request, jsonify, send_file
import os
import tempfile
import subprocess
import re
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import shutil

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
app.config['UPLOAD_EXTENSIONS'] = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'}

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def validate_target_size(target_size):
    """Validate target size format and values"""
    if not target_size:
        return False, "Target size is required"
    
    # Only allow alphanumeric characters and 'x'
    if not re.match(r'^[0-9]+x[0-9]+$', target_size):
        return False, "Invalid target size format. Expected format: WIDTHxHEIGHT"
    
    try:
        width, height = target_size.split('x')
        width, height = int(width), int(height)
        
        # Reasonable size limits to prevent resource exhaustion
        if width <= 0 or height <= 0:
            return False, "Width and height must be positive integers"
        if width > 2000 or height > 2000:
            return False, "Width and height must not exceed 2000 pixels"
        
        return True, None
    except ValueError:
        return False, "Invalid target size format"

def validate_delay(delay):
    """Validate delay parameter"""
    try:
        delay_int = int(delay)
        if delay_int < 1 or delay_int > 10000:
            return False, "Delay must be between 1 and 10000 milliseconds"
        return True, None
    except (ValueError, TypeError):
        return False, "Delay must be a valid integer"

def validate_file_extension(filename):
    """Validate file extension"""
    if '.' not in filename:
        return False
    ext = '.' + filename.rsplit('.', 1)[1].lower()
    return ext in app.config['UPLOAD_EXTENSIONS']

def safe_subprocess_call(cmd, cwd=None):
    """Safely execute subprocess with timeout and error handling"""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            check=True
        )
        return True, result.stdout
    except subprocess.TimeoutExpired:
        return False, "Operation timed out"
    except subprocess.CalledProcessError as e:
        return False, f"Command failed: {e.returncode}"
    except Exception:
        return False, "Unexpected error during image processing"

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate request content type
        if 'multipart/form-data' not in request.content_type:
            return jsonify({'error': 'Content-Type must be multipart/form-data'}), 400

        # Get form data
        target_size = request.form.get('targetSize')
        delay = request.form.get('delay', '10')
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'

        # Validate target size
        valid_size, size_error = validate_target_size(target_size)
        if not valid_size:
            return jsonify({'error': size_error}), 400

        # Validate delay
        valid_delay, delay_error = validate_delay(delay)
        if not valid_delay:
            return jsonify({'error': delay_error}), 400

        # Get uploaded files
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400

        files = request.files.getlist('images')
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400

        # Limit number of files to prevent resource exhaustion
        if len(files) > 50:
            return jsonify({'error': 'Too many images. Maximum 50 images allowed'}), 400

        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save and validate uploaded files
        image_paths = []
        for i, file in enumerate(files):
            if file.filename == '':
                continue
                
            # Validate file extension
            if not validate_file_extension(file.filename):
                return jsonify({'error': f'Invalid file type for {file.filename}'}), 400

            # Secure filename
            filename = secure_filename(f"image_{i}_{file.filename}")
            if not filename:
                return jsonify({'error': 'Invalid filename'}), 400
                
            filepath = os.path.join(temp_dir, filename)
            
            # Save file with size limit check
            try:
                file.save(filepath)
                # Check file size after saving
                if os.path.getsize(filepath) > 10 * 1024 * 1024:  # 10MB per file
                    return jsonify({'error': 'Individual file size too large'}), 400
                image_paths.append(filepath)
            except Exception:
                return jsonify({'error': 'Failed to save uploaded file'}), 400

        if not image_paths:
            return jsonify({'error': 'No valid images provided'}), 400

        # Prepare ImageMagick command
        output_path = os.path.join(temp_dir, 'output.gif')
        
        # Build command safely
        cmd = ['convert']
        
        # Add delay parameter (convert to centiseconds for ImageMagick)
        delay_cs = max(1, int(delay) // 10)  # Convert ms to centiseconds, minimum 1
        cmd.extend(['-delay', str(delay_cs)])
        
        # Add input images
        cmd.extend(image_paths)
        
        # Add reverted images if requested
        if append_reverted:
            # Add images in reverse order (excluding the last one to avoid duplication)
            cmd.extend(reversed(image_paths[:-1]))
        
        # Add resize parameter
        cmd.extend(['-resize', target_size])
        
        # Add output path
        cmd.append(output_path)

        # Execute ImageMagick command
        success, error_msg = safe_subprocess_call(cmd, cwd=temp_dir)
        if not success:
            return jsonify({'error': 'Failed to create GIF'}), 500

        # Check if output file was created
        if not os.path.exists(output_path):
            return jsonify({'error': 'Failed to create GIF'}), 500

        # Return the GIF file
        return send_file(
            output_path,
            mimetype='image/gif',
            as_attachment=True,
            download_name='animated.gif'
        )

    except RequestEntityTooLarge:
        return jsonify({'error': 'Request too large'}), 400
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass  # Ignore cleanup errors

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