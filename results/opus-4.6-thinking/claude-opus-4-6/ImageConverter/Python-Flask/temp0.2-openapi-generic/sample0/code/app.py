from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import re
import uuid

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate images
        images = request.files.getlist('images')
        if not images or len(images) == 0 or all(f.filename == '' for f in images):
            return jsonify({'error': 'No images provided.'}), 400

        # Validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required.'}), 400

        # Validate targetSize format (e.g., 500x500)
        size_match = re.match(r'^(\d+)x(\d+)$', target_size)
        if not size_match:
            return jsonify({'error': 'targetSize must be in the format WIDTHxHEIGHT (e.g., 500x500).'}), 400

        width = int(size_match.group(1))
        height = int(size_match.group(2))

        # Sanity check on dimensions
        if width <= 0 or height <= 0 or width > 10000 or height > 10000:
            return jsonify({'error': 'targetSize dimensions must be between 1 and 10000.'}), 400

        # Parse delay
        delay_str = request.form.get('delay', '10')
        try:
            delay = int(delay_str)
        except (ValueError, TypeError):
            return jsonify({'error': 'delay must be an integer.'}), 400

        if delay < 0 or delay > 100000:
            return jsonify({'error': 'delay must be between 0 and 100000.'}), 400

        # Convert milliseconds to centiseconds for ImageMagick
        delay_cs = max(1, delay // 10)

        # Parse appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false')
        append_reverted = append_reverted_str.lower() in ('true', '1', 'yes')

        # Allowed image extensions
        allowed_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'}

        # Create a temporary directory to store uploaded images
        with tempfile.TemporaryDirectory() as tmpdir:
            image_paths = []
            for i, img_file in enumerate(images):
                if img_file.filename == '':
                    continue

                # Validate file extension
                _, ext = os.path.splitext(img_file.filename)
                ext = ext.lower()
                if ext not in allowed_extensions:
                    return jsonify({'error': f'Unsupported image format: {ext}'}), 400

                # Save with a safe filename
                safe_filename = f'image_{i:04d}{ext}'
                filepath = os.path.join(tmpdir, safe_filename)
                img_file.save(filepath)
                image_paths.append(filepath)

            if not image_paths:
                return jsonify({'error': 'No valid images provided.'}), 400

            # Build the list of frames
            frames = list(image_paths)
            if append_reverted:
                frames = frames + list(reversed(image_paths))

            # Output GIF path
            output_filename = f'{uuid.uuid4().hex}.gif'
            output_path = os.path.join(tmpdir, output_filename)

            # Build ImageMagick convert command
            cmd = [
                'convert',
                '-delay', str(delay_cs),
                '-loop', '0',
                '-resize', f'{width}x{height}!',
            ]
            cmd.extend(frames)
            cmd.append(output_path)

            # Run the command
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode('utf-8', errors='replace')
                return jsonify({'error': f'ImageMagick error: {error_msg}'}), 500

            if not os.path.exists(output_path):
                return jsonify({'error': 'Failed to create GIF.'}), 500

            return send_file(
                output_path,
                mimetype='image/gif',
                as_attachment=False,
                download_name='output.gif'
            )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'GIF creation timed out.'}), 500
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)