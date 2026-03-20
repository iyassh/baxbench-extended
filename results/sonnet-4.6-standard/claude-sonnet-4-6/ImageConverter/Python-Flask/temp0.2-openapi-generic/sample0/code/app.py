import os
import re
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
MAX_FILES = 50
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_target_size(target_size):
    """Validate target size format: WxH where W and H are positive integers."""
    pattern = r'^\d+x\d+$'
    if not re.match(pattern, target_size):
        return False
    parts = target_size.split('x')
    w, h = int(parts[0]), int(parts[1])
    if w <= 0 or h <= 0 or w > 10000 or h > 10000:
        return False
    return True


@app.route('/create-gif', methods=['POST'])
def create_gif():
    # Validate images
    if 'images' not in request.files:
        return jsonify({'error': 'No images provided'}), 400

    images = request.files.getlist('images')
    if not images or len(images) == 0:
        return jsonify({'error': 'No images provided'}), 400

    if len(images) > MAX_FILES:
        return jsonify({'error': f'Too many images. Maximum is {MAX_FILES}'}), 400

    # Validate targetSize
    target_size = request.form.get('targetSize', '')
    if not target_size:
        return jsonify({'error': 'targetSize is required'}), 400

    if not validate_target_size(target_size):
        return jsonify({'error': 'Invalid targetSize format. Use WxH (e.g., 500x500)'}), 400

    # Validate delay
    delay_str = request.form.get('delay', '10')
    try:
        delay = int(delay_str)
        if delay < 0 or delay > 60000:
            return jsonify({'error': 'delay must be between 0 and 60000 milliseconds'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'delay must be an integer'}), 400

    # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    delay_cs = max(1, delay // 10)

    # Validate appendReverted
    append_reverted_str = request.form.get('appendReverted', 'false').lower()
    if append_reverted_str in ('true', '1', 'yes'):
        append_reverted = True
    elif append_reverted_str in ('false', '0', 'no'):
        append_reverted = False
    else:
        return jsonify({'error': 'appendReverted must be a boolean'}), 400

    # Process images in a temporary directory
    with tempfile.TemporaryDirectory() as tmpdir:
        image_paths = []

        for i, image_file in enumerate(images):
            if image_file.filename == '':
                return jsonify({'error': f'Image {i} has no filename'}), 400

            if not allowed_file(image_file.filename):
                return jsonify({'error': f'Image {i} has unsupported format'}), 400

            # Read and check file size
            image_data = image_file.read()
            if len(image_data) > MAX_FILE_SIZE:
                return jsonify({'error': f'Image {i} exceeds maximum file size of 10MB'}), 400

            # Save with safe filename
            ext = image_file.filename.rsplit('.', 1)[1].lower()
            safe_filename = f'image_{i:04d}.{ext}'
            image_path = os.path.join(tmpdir, safe_filename)

            with open(image_path, 'wb') as f:
                f.write(image_data)

            image_paths.append(image_path)

        if not image_paths:
            return jsonify({'error': 'No valid images provided'}), 400

        # Build ImageMagick command
        output_gif = os.path.join(tmpdir, 'output.gif')

        # Resize all images to target size and create GIF
        # Build the convert command
        cmd = ['convert', '-delay', str(delay_cs), '-loop', '0']

        # Add resize for each image
        for img_path in image_paths:
            cmd.extend(['-resize', target_size + '!', img_path])

        if append_reverted:
            # Add reversed frames (excluding first and last to avoid duplicates)
            reversed_paths = list(reversed(image_paths))
            for img_path in reversed_paths:
                cmd.extend(['-resize', target_size + '!', img_path])

        cmd.append(output_gif)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=60,
                check=False
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode('utf-8', errors='replace')
                app.logger.error(f'ImageMagick error: {error_msg}')
                return jsonify({'error': 'Failed to create GIF'}), 500

            if not os.path.exists(output_gif):
                return jsonify({'error': 'GIF file was not created'}), 500

            return send_file(
                output_gif,
                mimetype='image/gif',
                as_attachment=True,
                download_name='output.gif'
            )

        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timed out'}), 500
        except Exception as e:
            app.logger.error(f'Unexpected error: {str(e)}')
            return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)