import os
import io
import re
import subprocess
import tempfile
import logging
from flask import Flask, request, jsonify, send_file, after_this_request

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security constants
MAX_IMAGES = 50
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB per image
MAX_TOTAL_SIZE = 100 * 1024 * 1024  # 100 MB total
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif'}
MAX_DIMENSION = 4096
MIN_DIMENSION = 1
MAX_DELAY = 10000
MIN_DELAY = 1


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def allowed_file(filename):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def parse_target_size(target_size):
    """Parse and validate target size string like '500x500'."""
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, target_size.strip())
    if not match:
        return None, None, "Invalid targetSize format. Expected WxH (e.g., 500x500)."
    
    width = int(match.group(1))
    height = int(match.group(2))
    
    if width < MIN_DIMENSION or width > MAX_DIMENSION:
        return None, None, f"Width must be between {MIN_DIMENSION} and {MAX_DIMENSION}."
    if height < MIN_DIMENSION or height > MAX_DIMENSION:
        return None, None, f"Height must be between {MIN_DIMENSION} and {MAX_DIMENSION}."
    
    return width, height, None


@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Get images from request
        images = request.files.getlist('images')
        
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided.'}), 400
        
        if len(images) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum allowed is {MAX_IMAGES}.'}), 400
        
        # Validate targetSize
        target_size = request.form.get('targetSize', '').strip()
        if not target_size:
            return jsonify({'error': 'targetSize is required.'}), 400
        
        width, height, size_error = parse_target_size(target_size)
        if size_error:
            return jsonify({'error': size_error}), 400
        
        # Validate delay
        delay_str = request.form.get('delay', '10')
        try:
            delay = int(delay_str)
        except (ValueError, TypeError):
            return jsonify({'error': 'delay must be an integer.'}), 400
        
        if delay < MIN_DELAY or delay > MAX_DELAY:
            return jsonify({'error': f'delay must be between {MIN_DELAY} and {MAX_DELAY} milliseconds.'}), 400
        
        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = max(1, delay // 10)
        
        # Validate appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false').strip().lower()
        if append_reverted_str in ('true', '1', 'yes'):
            append_reverted = True
        elif append_reverted_str in ('false', '0', 'no'):
            append_reverted = False
        else:
            return jsonify({'error': 'appendReverted must be a boolean value.'}), 400
        
        # Validate and save images to temp directory
        temp_dir = tempfile.mkdtemp()
        
        total_size = 0
        image_paths = []
        
        for i, image_file in enumerate(images):
            if image_file.filename == '':
                return jsonify({'error': f'Image {i+1} has no filename.'}), 400
            
            if not allowed_file(image_file.filename):
                return jsonify({'error': f'Image {i+1} has an unsupported file type.'}), 400
            
            # Read image data
            image_data = image_file.read(MAX_IMAGE_SIZE + 1)
            if len(image_data) > MAX_IMAGE_SIZE:
                return jsonify({'error': f'Image {i+1} exceeds maximum size of {MAX_IMAGE_SIZE // (1024*1024)} MB.'}), 400
            
            total_size += len(image_data)
            if total_size > MAX_TOTAL_SIZE:
                return jsonify({'error': 'Total image size exceeds maximum allowed.'}), 400
            
            # Save with safe filename (no user-controlled path components)
            ext = image_file.filename.rsplit('.', 1)[1].lower()
            safe_filename = f'image_{i:04d}.{ext}'
            image_path = os.path.join(temp_dir, safe_filename)
            
            # Ensure path is within temp_dir
            real_temp_dir = os.path.realpath(temp_dir)
            real_image_path = os.path.realpath(image_path)
            if not real_image_path.startswith(real_temp_dir + os.sep):
                return jsonify({'error': 'Invalid file path.'}), 400
            
            with open(image_path, 'wb') as f:
                f.write(image_data)
            
            image_paths.append(image_path)
        
        # Output GIF path
        output_path = os.path.join(temp_dir, 'output.gif')
        real_output_path = os.path.realpath(output_path)
        real_temp_dir = os.path.realpath(temp_dir)
        if not real_output_path.startswith(real_temp_dir + os.sep):
            return jsonify({'error': 'Invalid output path.'}), 400
        
        # Build ImageMagick command using list form to avoid shell injection
        # Resize all images to target size and create GIF
        size_str = f'{width}x{height}'
        
        cmd = ['convert', '-delay', str(delay_cs), '-loop', '0']
        
        for img_path in image_paths:
            cmd.extend(['-resize', size_str + '!', img_path])
        
        if append_reverted:
            # Append reversed frames (excluding first and last to avoid duplicates)
            reversed_paths = list(reversed(image_paths))
            for img_path in reversed_paths:
                cmd.extend(['-resize', size_str + '!', img_path])
        
        cmd.append(output_path)
        
        # Run ImageMagick with timeout and resource limits
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=60,
                check=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timed out.'}), 500
        except FileNotFoundError:
            return jsonify({'error': 'ImageMagick is not installed.'}), 500
        
        if result.returncode != 0:
            logger.error('ImageMagick error: %s', result.stderr.decode('utf-8', errors='replace'))
            return jsonify({'error': 'Failed to create GIF.'}), 500
        
        if not os.path.exists(output_path):
            return jsonify({'error': 'GIF was not created.'}), 500
        
        # Read the output GIF
        with open(output_path, 'rb') as f:
            gif_data = f.read()
        
        # Clean up temp directory
        import shutil
        
        @after_this_request
        def cleanup(response):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
            return response
        
        return send_file(
            io.BytesIO(gif_data),
            mimetype='image/gif',
            as_attachment=False,
            download_name='output.gif'
        )
    
    except Exception as e:
        logger.exception('Unexpected error in create_gif')
        # Clean up temp dir if it exists
        if temp_dir and os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({'error': 'An internal server error occurred.'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)