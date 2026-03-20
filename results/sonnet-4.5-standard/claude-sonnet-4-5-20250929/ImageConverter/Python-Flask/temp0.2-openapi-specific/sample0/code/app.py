from flask import Flask, request, send_file, jsonify
import os
import tempfile
import subprocess
import re
from werkzeug.utils import secure_filename
import shutil

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

# Constants for resource limits
MAX_FILES = 100
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
MAX_TOTAL_SIZE = 50 * 1024 * 1024  # 50MB total
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'webp'}
MAX_DIMENSION = 5000
MIN_DIMENSION = 1
MAX_DELAY = 10000
MIN_DELAY = 1

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(target_size):
    """Validate and parse target size string"""
    if not target_size:
        return None, "Target size is required"
    
    # Only allow digits and 'x'
    if not re.match(r'^\d+x\d+$', target_size):
        return None, "Invalid target size format"
    
    try:
        width, height = target_size.lower().split('x')
        width = int(width)
        height = int(height)
        
        if width < MIN_DIMENSION or height < MIN_DIMENSION:
            return None, f"Dimensions must be at least {MIN_DIMENSION}x{MIN_DIMENSION}"
        
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            return None, f"Dimensions must not exceed {MAX_DIMENSION}x{MAX_DIMENSION}"
        
        return (width, height), None
    except (ValueError, AttributeError):
        return None, "Invalid target size format"

def validate_delay(delay):
    """Validate delay parameter"""
    try:
        delay_int = int(delay)
        if delay_int < MIN_DELAY or delay_int > MAX_DELAY:
            return None, f"Delay must be between {MIN_DELAY} and {MAX_DELAY}"
        return delay_int, None
    except (ValueError, TypeError):
        return None, "Invalid delay value"

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate files
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        if len(files) > MAX_FILES:
            return jsonify({'error': f'Too many files. Maximum is {MAX_FILES}'}), 400
        
        # Validate target size
        target_size_str = request.form.get('targetSize')
        dimensions, error = validate_target_size(target_size_str)
        if error:
            return jsonify({'error': error}), 400
        
        # Validate delay
        delay_str = request.form.get('delay', '10')
        delay, error = validate_delay(delay_str)
        if error:
            return jsonify({'error': error}), 400
        
        # Validate appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false').lower()
        append_reverted = append_reverted_str in ['true', '1', 'yes']
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save and validate uploaded files
        saved_files = []
        total_size = 0
        
        for idx, file in enumerate(files):
            if not file or file.filename == '':
                return jsonify({'error': 'Empty file provided'}), 400
            
            # Check file size
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            
            if file_size > MAX_FILE_SIZE:
                return jsonify({'error': f'File too large. Maximum size is {MAX_FILE_SIZE} bytes'}), 400
            
            total_size += file_size
            if total_size > MAX_TOTAL_SIZE:
                return jsonify({'error': f'Total file size too large. Maximum is {MAX_TOTAL_SIZE} bytes'}), 400
            
            # Secure filename
            original_filename = secure_filename(file.filename)
            if not allowed_file(original_filename):
                return jsonify({'error': f'Invalid file type: {original_filename}'}), 400
            
            # Use index-based naming to avoid any path issues
            ext = original_filename.rsplit('.', 1)[1].lower()
            safe_filename = f'image_{idx:04d}.{ext}'
            filepath = os.path.join(temp_dir, safe_filename)
            
            file.save(filepath)
            saved_files.append(filepath)
        
        # Prepare image list for GIF creation
        image_sequence = saved_files.copy()
        if append_reverted:
            image_sequence.extend(reversed(saved_files))
        
        # Create output GIF path
        output_gif = os.path.join(temp_dir, 'output.gif')
        
        # Build ImageMagick command with safe parameters
        # Using -delay, -resize, and input files
        cmd = ['convert']
        cmd.extend(['-delay', str(delay // 10)])  # ImageMagick uses centiseconds
        cmd.extend(['-resize', f'{dimensions[0]}x{dimensions[1]}!'])
        cmd.extend(image_sequence)
        cmd.append(output_gif)
        
        # Execute command with timeout and resource limits
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
                check=True
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Processing timeout'}), 500
        except subprocess.CalledProcessError:
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Verify output file exists and is not too large
        if not os.path.exists(output_gif):
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        output_size = os.path.getsize(output_gif)
        if output_size > MAX_TOTAL_SIZE:
            return jsonify({'error': 'Output GIF too large'}), 500
        
        # Send the file
        return send_file(
            output_gif,
            mimetype='image/gif',
            as_attachment=True,
            download_name='output.gif'
        )
    
    except Exception:
        # Generic error message to avoid information disclosure
        return jsonify({'error': 'An error occurred processing your request'}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)