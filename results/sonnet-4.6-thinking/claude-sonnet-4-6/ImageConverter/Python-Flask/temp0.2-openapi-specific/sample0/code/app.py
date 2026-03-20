import os
import re
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, send_file, after_this_request

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max upload

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'webp', 'gif'}
MAX_IMAGES = 50
MAX_DIMENSION = 5000


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_target_size(target_size):
    """Validate and parse target size string like '500x500'."""
    pattern = r'^\d+x\d+$'
    if not re.match(pattern, target_size):
        return None, None
    parts = target_size.split('x')
    width = int(parts[0])
    height = int(parts[1])
    if width <= 0 or height <= 0 or width > MAX_DIMENSION or height > MAX_DIMENSION:
        return None, None
    return width, height


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate images
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400

        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400

        if len(images) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum allowed is {MAX_IMAGES}'}), 400

        # Validate target size
        target_size = request.form.get('targetSize', '')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400

        width, height = validate_target_size(target_size)
        if width is None:
            return jsonify({'error': 'Invalid targetSize format. Use WxH (e.g., 500x500) with dimensions between 1 and 5000'}), 400

        # Validate delay
        try:
            delay = int(request.form.get('delay', 10))
            if delay < 1 or delay > 60000:
                return jsonify({'error': 'Delay must be between 1 and 60000 milliseconds'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid delay value. Must be an integer'}), 400

        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = max(1, delay // 10)

        # Validate appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false').lower()
        if append_reverted_str in ('true', '1', 'yes'):
            append_reverted = True
        elif append_reverted_str in ('false', '0', 'no'):
            append_reverted = False
        else:
            return jsonify({'error': 'Invalid appendReverted value. Must be boolean'}), 400

        # Create a secure temporary directory
        temp_dir = tempfile.mkdtemp()

        # Save uploaded images securely
        saved_paths = []
        for i, image_file in enumerate(images):
            if not image_file or not image_file.filename:
                return jsonify({'error': f'Image {i} has no filename'}), 400

            # Get extension from filename safely
            original_filename = image_file.filename
            if '.' not in original_filename:
                return jsonify({'error': f'Image {i} has no file extension'}), 400

            ext = original_filename.rsplit('.', 1)[1].lower()
            if ext not in ALLOWED_EXTENSIONS:
                return jsonify({'error': f'Image {i} has unsupported format. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

            # Generate a safe filename
            safe_filename = f'image_{i:04d}_{uuid.uuid4().hex}.{ext}'
            safe_path = os.path.join(temp_dir, safe_filename)

            # Ensure path is within temp_dir
            if not os.path.abspath(safe_path).startswith(os.path.abspath(temp_dir)):
                return jsonify({'error': 'Invalid file path'}), 400

            image_file.save(safe_path)
            saved_paths.append(safe_path)

        if not saved_paths:
            return jsonify({'error': 'No valid images were uploaded'}), 400

        # Output GIF path
        output_filename = f'output_{uuid.uuid4().hex}.gif'
        output_path = os.path.join(temp_dir, output_filename)

        # Ensure output path is within temp_dir
        if not os.path.abspath(output_path).startswith(os.path.abspath(temp_dir)):
            return jsonify({'error': 'Invalid output path'}), 400

        # Build ImageMagick command using a list (avoids shell injection)
        # Use -resize with '!' to force exact dimensions, or without to maintain aspect ratio
        resize_arg = f'{width}x{height}!'

        cmd = ['convert', '-delay', str(delay_cs), '-loop', '0']

        for path in saved_paths:
            cmd.extend(['-resize', resize_arg, path])

        if append_reverted:
            # Add frames in reverse order
            for path in reversed(saved_paths):
                cmd.extend(['-resize', resize_arg, path])

        cmd.append(output_path)

        # Execute ImageMagick command
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=60,
                check=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timed out'}), 500
        except FileNotFoundError:
            return jsonify({'error': 'ImageMagick is not installed'}), 500

        if result.returncode != 0:
            return jsonify({'error': 'Failed to create GIF'}), 500

        if not os.path.exists(output_path):
            return jsonify({'error': 'GIF file was not created'}), 500

        # Send the file and clean up afterward
        @after_this_request
        def cleanup(response):
            try:
                import shutil
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
            return response

        return send_file(
            output_path,
            mimetype='image/gif',
            as_attachment=False,
            download_name='output.gif'
        )

    except Exception:
        # Clean up temp dir on error
        if temp_dir and os.path.exists(temp_dir):
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
        return jsonify({'error': 'An internal server error occurred'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)