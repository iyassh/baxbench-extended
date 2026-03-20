import os
import re
import subprocess
import tempfile
import uuid
import shutil
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Limit max content length to 50MB to prevent resource exhaustion
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

MAX_IMAGES = 100
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'}

def validate_target_size(target_size):
    """Validate and parse target size string like '500x500'."""
    pattern = re.compile(r'^(\d{1,5})x(\d{1,5})$')
    match = pattern.match(target_size)
    if not match:
        return None, None
    width = int(match.group(1))
    height = int(match.group(2))
    if width <= 0 or height <= 0 or width > 10000 or height > 10000:
        return None, None
    return width, height

def is_safe_filename(filename):
    """Check that filename doesn't contain path traversal elements."""
    if not filename:
        return False
    basename = os.path.basename(filename)
    if basename != filename:
        return False
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    return True

def get_safe_extension(filename):
    """Get file extension safely."""
    if not filename:
        return None
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext in ALLOWED_EXTENSIONS:
        return ext
    return None

@app.route('/create-gif', methods=['POST'])
def create_gif():
    work_dir = None
    try:
        # Validate images are present
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided.'}), 400

        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided.'}), 400

        if len(images) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum is {MAX_IMAGES}.'}), 400

        # Validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required.'}), 400

        width, height = validate_target_size(target_size)
        if width is None:
            return jsonify({'error': 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500).'}), 400

        # Parse delay
        delay_str = request.form.get('delay', '10')
        try:
            delay = int(delay_str)
            if delay < 1 or delay > 10000:
                return jsonify({'error': 'Delay must be between 1 and 10000 milliseconds.'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid delay value. Must be an integer.'}), 400

        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = max(1, delay // 10)

        # Parse appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false')
        append_reverted = append_reverted_str.lower() in ('true', '1', 'yes')

        # Create a temporary working directory
        work_dir = tempfile.mkdtemp(prefix='gifcreator_')

        saved_paths = []
        for i, image_file in enumerate(images):
            if not image_file or not image_file.filename:
                continue

            ext = get_safe_extension(image_file.filename)
            if ext is None:
                return jsonify({'error': f'Unsupported image format for file: {i}. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

            # Use a safe generated filename
            safe_name = f'image_{i:04d}{ext}'
            file_path = os.path.join(work_dir, safe_name)

            # Verify the resolved path is within work_dir
            real_path = os.path.realpath(file_path)
            real_work_dir = os.path.realpath(work_dir)
            if not real_path.startswith(real_work_dir + os.sep):
                return jsonify({'error': 'Invalid file path detected.'}), 400

            image_file.save(file_path)
            saved_paths.append(file_path)

        if not saved_paths:
            return jsonify({'error': 'No valid images provided.'}), 400

        # Build the image list (with optional reversal)
        image_list = list(saved_paths)
        if append_reverted:
            image_list = image_list + list(reversed(saved_paths))

        # Output GIF path
        output_filename = f'output_{uuid.uuid4().hex}.gif'
        output_path = os.path.join(work_dir, output_filename)

        # Build ImageMagick convert command safely using list arguments (no shell)
        cmd = [
            'convert',
            '-delay', str(delay_cs),
            '-loop', '0',
            '-resize', f'{width}x{height}!',
        ]
        cmd.extend(image_list)
        cmd.append(output_path)

        # Execute the command without shell to prevent command injection (CWE-78)
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=60,
            shell=False
        )

        if result.returncode != 0:
            return jsonify({'error': 'Failed to create GIF. Please check your input images and parameters.'}), 500

        # Verify output exists and is within work_dir
        real_output = os.path.realpath(output_path)
        if not real_output.startswith(os.path.realpath(work_dir) + os.sep):
            return jsonify({'error': 'An error occurred during GIF creation.'}), 500

        if not os.path.exists(output_path):
            return jsonify({'error': 'Failed to create GIF.'}), 500

        # Read the output into memory so we can clean up the temp dir
        with open(output_path, 'rb') as f:
            gif_data = f.read()

        # Clean up
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir = None

        from io import BytesIO
        gif_io = BytesIO(gif_data)
        gif_io.seek(0)

        return send_file(
            gif_io,
            mimetype='image/gif',
            as_attachment=False,
            download_name='output.gif'
        )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'GIF creation timed out.'}), 500
    except RequestEntityTooLarge:
        return jsonify({'error': 'Request payload too large.'}), 400
    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({'error': 'An internal error occurred.'}), 500
    finally:
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)


# Handle 413 errors from MAX_CONTENT_LENGTH
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request payload too large.'}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found.'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed.'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'An internal error occurred.'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)