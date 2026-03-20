from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import shutil

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate images
        images = request.files.getlist('images')
        if not images or len(images) == 0 or (len(images) == 1 and images[0].filename == ''):
            return jsonify({'error': 'No images provided'}), 400

        # Validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400

        # Parse target size
        try:
            parts = target_size.lower().split('x')
            if len(parts) != 2:
                return jsonify({'error': 'Invalid targetSize format. Expected WIDTHxHEIGHT'}), 400
            width = int(parts[0])
            height = int(parts[1])
        except (ValueError, IndexError):
            return jsonify({'error': 'Invalid targetSize format. Expected WIDTHxHEIGHT'}), 400

        # Parse delay
        delay = request.form.get('delay', '10')
        try:
            delay = int(delay)
        except ValueError:
            return jsonify({'error': 'Invalid delay value'}), 400

        # Parse appendReverted
        append_reverted = request.form.get('appendReverted', 'false')
        if isinstance(append_reverted, str):
            append_reverted = append_reverted.lower() in ('true', '1', 'yes')

        # Create temp directory
        tmp_dir = tempfile.mkdtemp()

        try:
            # Save uploaded images
            image_paths = []
            for i, img in enumerate(images):
                if img.filename == '':
                    continue
                ext = os.path.splitext(img.filename)[1] if img.filename else '.png'
                if not ext:
                    ext = '.png'
                path = os.path.join(tmp_dir, f'image_{i:04d}{ext}')
                img.save(path)
                image_paths.append(path)

            if not image_paths:
                return jsonify({'error': 'No valid images provided'}), 400

            # If appendReverted, append reversed images (excluding first and last to avoid duplicates)
            if append_reverted:
                reverted = list(reversed(image_paths))
                if len(reverted) > 2:
                    reverted = reverted[1:-1]
                elif len(reverted) > 1:
                    reverted = reverted[1:]
                else:
                    reverted = []
                image_paths = image_paths + reverted

            # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
            delay_cs = max(1, delay // 10)

            # Build convert command
            output_path = os.path.join(tmp_dir, 'output.gif')
            cmd = [
                'convert',
                '-delay', str(delay_cs),
                '-loop', '0',
                '-resize', f'{width}x{height}!',
            ]
            cmd.extend(image_paths)
            cmd.append(output_path)

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

            if result.returncode != 0:
                return jsonify({'error': f'ImageMagick error: {result.stderr}'}), 500

            if not os.path.exists(output_path):
                return jsonify({'error': 'Failed to create GIF'}), 500

            return send_file(
                output_path,
                mimetype='image/gif',
                as_attachment=False,
                download_name='output.gif'
            )

        finally:
            # Clean up will happen after response is sent
            # We need to keep files until response is sent, so we use a different approach
            pass

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)