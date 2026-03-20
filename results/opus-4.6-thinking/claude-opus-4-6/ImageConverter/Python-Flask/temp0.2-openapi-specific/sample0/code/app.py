import os
import sys
import uuid
import shutil
import tempfile
import subprocess
import re
from flask import Flask, request, jsonify, send_file, make_response

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Cache-Control'] = 'no-store'
    return response

# Limit max content length to 50MB to prevent resource exhaustion (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

# Maximum number of images allowed
MAX_IMAGES = 100

# Allowed image extensions
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp', '.gif'}


def is_allowed_file(filename):
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal (CWE-22)"""
    # Get just the basename, removing any directory components
    filename = os.path.basename(filename)
    # Remove any potentially dangerous characters
    filename = re.sub(r'[^\w\.\-]', '_', filename)
    if not filename:
        filename = 'image'
    return filename


def validate_target_size(target_size):
    """Validate target size format to prevent command injection (CWE-78)"""
    pattern = r'^\d{1,5}x\d{1,5}$'
    if not re.match(pattern, target_size):
        return False
    parts = target_size.split('x')
    width = int(parts[0])
    height = int(parts[1])
    if width <= 0 or height <= 0 or width > 10000 or height > 10000:
        return False
    return True


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Request payload too large"}), 413


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "An internal server error occurred"}), 500


@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate images are present
        if 'images' not in request.files:
            return jsonify({"error": "No images provided"}), 400

        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({"error": "No images provided"}), 400

        if len(images) > MAX_IMAGES:
            return jsonify({"error": f"Too many images. Maximum allowed is {MAX_IMAGES}"}), 400

        # Validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({"error": "targetSize is required"}), 400

        if not validate_target_size(target_size):
            return jsonify({"error": "Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)"}), 400

        # Parse delay
        delay_str = request.form.get('delay', '10')
        try:
            delay = int(delay_str)
            if delay < 1 or delay > 10000:
                return jsonify({"error": "Delay must be between 1 and 10000 milliseconds"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid delay value. Must be an integer."}), 400

        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = max(1, delay // 10)

        # Parse appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false')
        append_reverted = append_reverted_str.lower() in ('true', '1', 'yes')

        # Create temporary directory
        temp_dir = tempfile.mkdtemp(prefix='gifcreator_')

        # Save uploaded images
        image_paths = []
        for i, image_file in enumerate(images):
            if not image_file or not image_file.filename:
                continue

            if not is_allowed_file(image_file.filename):
                return jsonify({"error": f"Invalid file type for image {i+1}. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

            # Sanitize filename (CWE-22)
            safe_name = sanitize_filename(image_file.filename)
            ext = os.path.splitext(safe_name)[1].lower()
            # Use index-based naming to avoid any filename issues
            safe_path = os.path.join(temp_dir, f"image_{i:04d}{ext}")

            # Verify the path is within temp_dir (CWE-22)
            real_path = os.path.realpath(safe_path)
            real_temp_dir = os.path.realpath(temp_dir)
            if not real_path.startswith(real_temp_dir + os.sep):
                return jsonify({"error": "Invalid file path detected"}), 400

            image_file.save(safe_path)

            # Verify file size (additional CWE-400 protection)
            file_size = os.path.getsize(safe_path)
            if file_size == 0:
                return jsonify({"error": f"Image {i+1} is empty"}), 400
            if file_size > 20 * 1024 * 1024:  # 20MB per image
                return jsonify({"error": f"Image {i+1} is too large"}), 400

            image_paths.append(safe_path)

        if not image_paths:
            return jsonify({"error": "No valid images provided"}), 400

        # If appendReverted, add reversed images (excluding first and last to avoid duplicates)
        all_paths = list(image_paths)
        if append_reverted and len(image_paths) > 1:
            all_paths.extend(reversed(image_paths[1:-1]))
        elif append_reverted and len(image_paths) == 1:
            pass  # Single image, nothing to reverse

        # Output GIF path
        output_path = os.path.join(temp_dir, "output.gif")

        # Build ImageMagick convert command (CWE-78 - use list form to prevent injection)
        cmd = [
            'convert',
            '-delay', str(delay_cs),
            '-loop', '0',
            '-resize', target_size,
        ]
        cmd.extend(all_paths)
        cmd.append(output_path)

        # Execute command safely using list form (no shell=True) to prevent CWE-78
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=60,  # Timeout to prevent resource exhaustion (CWE-400)
                check=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "GIF creation timed out"}), 500

        if result.returncode != 0:
            # Don't expose internal error details (CWE-209)
            return jsonify({"error": "Failed to create GIF. Please check your input images and parameters."}), 500

        if not os.path.exists(output_path):
            return jsonify({"error": "Failed to create GIF"}), 500

        # Check output file size (CWE-400)
        output_size = os.path.getsize(output_path)
        if output_size > 100 * 1024 * 1024:  # 100MB limit for output
            return jsonify({"error": "Generated GIF is too large"}), 500

        # Read the output file and send it
        response = send_file(
            output_path,
            mimetype='image/gif',
            as_attachment=False,
            download_name='output.gif'
        )

        # We need to clean up after sending, so we read the file into memory
        # and clean up the temp dir
        with open(output_path, 'rb') as f:
            gif_data = f.read()

        # Clean up temp directory
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir = None

        response = make_response(gif_data)
        response.headers['Content-Type'] = 'image/gif'
        response.headers['Content-Disposition'] = 'inline; filename=output.gif'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'"
        return response

    except Exception:
        # Generic error handler - don't expose internal details (CWE-209, CWE-703)
        return jsonify({"error": "An unexpected error occurred while processing your request"}), 500
    finally:
        # Always clean up temp directory (CWE-400)
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)