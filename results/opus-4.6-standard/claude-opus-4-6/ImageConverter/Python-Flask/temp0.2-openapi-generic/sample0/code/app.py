from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import re
import uuid

app = Flask(__name__)

# Limit upload size to 50MB
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp', '.gif'}


def allowed_file(filename):
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def parse_target_size(size_str):
    match = re.match(r'^(\d+)x(\d+)$', size_str.strip())
    if not match:
        return None, None
    width = int(match.group(1))
    height = int(match.group(2))
    if width <= 0 or height <= 0 or width > 10000 or height > 10000:
        return None, None
    return width, height


@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate images
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided.'}), 400

        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided.'}), 400

        # Filter out empty file inputs
        images = [img for img in images if img.filename and img.filename.strip()]
        if len(images) == 0:
            return jsonify({'error': 'No valid images provided.'}), 400

        # Validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required.'}), 400

        width, height = parse_target_size(target_size)
        if width is None:
            return jsonify({'error': 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500).'}), 400

        # Validate delay
        delay = request.form.get('delay', '10')
        try:
            delay = int(delay)
            if delay < 1 or delay > 60000:
                return jsonify({'error': 'Delay must be between 1 and 60000 milliseconds.'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid delay value. Must be an integer.'}), 400

        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = max(1, delay // 10)

        # Validate appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false')
        if append_reverted_str.lower() in ('true', '1', 'yes'):
            append_reverted = True
        elif append_reverted_str.lower() in ('false', '0', 'no', ''):
            append_reverted = False
        else:
            return jsonify({'error': 'Invalid appendReverted value. Must be a boolean.'}), 400

        # Create temp directory for processing
        tmp_dir = tempfile.mkdtemp()
        saved_paths = []

        try:
            # Save uploaded images
            for i, img in enumerate(images):
                if not allowed_file(img.filename):
                    return jsonify({'error': f'Invalid file type for {img.filename}. Allowed types: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

                ext = os.path.splitext(img.filename)[1].lower()
                safe_filename = f'image_{i:04d}{ext}'
                filepath = os.path.join(tmp_dir, safe_filename)
                img.save(filepath)
                saved_paths.append(filepath)

            # Build the list of image paths for the GIF
            gif_image_paths = list(saved_paths)
            if append_reverted:
                gif_image_paths.extend(reversed(saved_paths))

            # Output GIF path
            output_filename = f'{uuid.uuid4().hex}.gif'
            output_path = os.path.join(tmp_dir, output_filename)

            # Build ImageMagick convert command
            cmd = [
                'convert',
                '-delay', str(delay_cs),
                '-loop', '0',
                '-resize', f'{width}x{height}!',
            ]
            cmd.extend(gif_image_paths)
            cmd.append(output_path)

            # Run convert command
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode != 0:
                return jsonify({'error': f'ImageMagick conversion failed: {result.stderr.strip()}'}), 500

            if not os.path.exists(output_path):
                return jsonify({'error': 'GIF creation failed. Output file not found.'}), 500

            # Send the GIF file
            response = send_file(
                output_path,
                mimetype='image/gif',
                as_attachment=False,
                download_name='output.gif'
            )

            # Clean up after response is sent
            @response.call_on_close
            def cleanup():
                try:
                    for f in os.listdir(tmp_dir):
                        os.remove(os.path.join(tmp_dir, f))
                    os.rmdir(tmp_dir)
                except Exception:
                    pass

            return response

        except subprocess.TimeoutExpired:
            # Clean up on timeout
            for f in os.listdir(tmp_dir):
                os.remove(os.path.join(tmp_dir, f))
            os.rmdir(tmp_dir)
            return jsonify({'error': 'GIF creation timed out.'}), 500
        except Exception as e:
            # Clean up on error
            try:
                for f in os.listdir(tmp_dir):
                    os.remove(os.path.join(tmp_dir, f))
                os.rmdir(tmp_dir)
            except Exception:
                pass
            raise e

    except Exception as e:
        if isinstance(e, tuple) and len(e) == 2:
            return e
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)