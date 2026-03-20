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
        return False, None, None
    parts = target_size.split('x')
    width, height = int(parts[0]), int(parts[1])
    if width <= 0 or height <= 0 or width > 10000 or height > 10000:
        return False, None, None
    return True, width, height


@app.route('/create-gif', methods=['POST'])
def create_gif():
    # Check images are present
    if 'images' not in request.files:
        return jsonify({'error': 'No images provided'}), 400

    images = request.files.getlist('images')
    if not images or len(images) == 0:
        return jsonify({'error': 'No images provided'}), 400

    if len(images) > MAX_FILES:
        return jsonify({'error': f'Too many images. Maximum allowed is {MAX_FILES}'}), 400

    # Validate targetSize
    target_size = request.form.get('targetSize', '')
    if not target_size:
        return jsonify({'error': 'targetSize is required'}), 400

    valid, width, height = validate_target_size(target_size)
    if not valid:
        return jsonify({'error': 'Invalid targetSize format. Use WxH (e.g., 500x500) with values between 1 and 10000'}), 400

    # Validate delay
    try:
        delay = int(request.form.get('delay', 10))
        if delay < 1 or delay > 60000:
            return jsonify({'error': 'delay must be between 1 and 60000 milliseconds'}), 400
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
        return jsonify({'error': 'appendReverted must be a boolean value'}), 400

    # Validate and save uploaded images
    with tempfile.TemporaryDirectory() as tmpdir:
        image_paths = []

        for i, image in enumerate(images):
            if image.filename == '':
                return jsonify({'error': f'Image {i} has no filename'}), 400

            if not allowed_file(image.filename):
                return jsonify({'error': f'Image {i} has unsupported file type'}), 400

            # Read and check file size
            image_data = image.read()
            if len(image_data) > MAX_FILE_SIZE:
                return jsonify({'error': f'Image {i} exceeds maximum file size of 10MB'}), 400

            # Save with safe filename
            ext = image.filename.rsplit('.', 1)[1].lower()
            safe_filename = f'image_{i:04d}.{ext}'
            image_path = os.path.join(tmpdir, safe_filename)

            with open(image_path, 'wb') as f:
                f.write(image_data)

            image_paths.append(image_path)

        if not image_paths:
            return jsonify({'error': 'No valid images provided'}), 400

        # Output GIF path
        output_gif = os.path.join(tmpdir, 'output.gif')

        # Build ImageMagick convert command
        # Resize each image to target size and create GIF
        cmd = ['convert', '-delay', str(delay_cs), '-loop', '0']

        # Add each image with resize
        for img_path in image_paths:
            cmd.extend(['-resize', f'{width}x{height}!', img_path])

        # If appendReverted, add images in reverse order
        if append_reverted:
            for img_path in reversed(image_paths):
                cmd.extend(['-resize', f'{width}x{height}!', img_path])

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

        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timed out'}), 500
        except Exception as e:
            app.logger.error(f'Unexpected error: {str(e)}')
            return jsonify({'error': 'Internal server error'}), 500

        if not os.path.exists(output_gif):
            return jsonify({'error': 'GIF file was not created'}), 500

        # Read the output GIF and return it
        with open(output_gif, 'rb') as f:
            gif_data = f.read()

    # Return the GIF
    import io
    return send_file(
        io.BytesIO(gif_data),
        mimetype='image/gif',
        as_attachment=False,
        download_name='output.gif'
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)