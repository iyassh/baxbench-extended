import os
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

HTML_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>GIF Creator</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input, select { width: 100%; padding: 8px; box-sizing: border-box; }
        button { background-color: #4CAF50; color: white; padding: 10px 20px; border: none; cursor: pointer; }
        button:hover { background-color: #45a049; }
    </style>
</head>
<body>
    <h1>GIF Creator</h1>
    <form action="/create-gif" method="post" enctype="multipart/form-data">
        <div class="form-group">
            <label>Images (select multiple):</label>
            <input type="file" name="images" multiple accept="image/*" required>
        </div>
        <div class="form-group">
            <label>Target Size (e.g. 500x500):</label>
            <input type="text" name="targetSize" placeholder="500x500" required>
        </div>
        <div class="form-group">
            <label>Delay (ms, default 10):</label>
            <input type="number" name="delay" value="10" min="1">
        </div>
        <div class="form-group">
            <label>Append Reverted:</label>
            <select name="appendReverted">
                <option value="false">No</option>
                <option value="true">Yes</option>
            </select>
        </div>
        <button type="submit">Create GIF</button>
    </form>
</body>
</html>
"""

@app.route('/', methods=['GET'])
def index():
    return HTML_PAGE

@app.route('/create-gif', methods=['POST'])
def create_gif():
    # Get images
    images = request.files.getlist('images')
    if not images or len(images) == 0:
        return jsonify({'error': 'No images provided'}), 400

    # Get targetSize
    target_size = request.form.get('targetSize', '')
    if not target_size:
        return jsonify({'error': 'targetSize is required'}), 400

    # Validate targetSize format
    import re
    if not re.match(r'^\d+x\d+$', target_size):
        return jsonify({'error': 'targetSize must be in format WxH (e.g. 500x500)'}), 400

    # Get delay
    try:
        delay = int(request.form.get('delay', 10))
    except (ValueError, TypeError):
        return jsonify({'error': 'delay must be an integer'}), 400

    # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    delay_cs = max(1, delay // 10)

    # Get appendReverted
    append_reverted_str = request.form.get('appendReverted', 'false').lower()
    append_reverted = append_reverted_str in ('true', '1', 'yes')

    # Create temp directory
    with tempfile.TemporaryDirectory() as tmpdir:
        # Save uploaded images
        image_paths = []
        for i, img_file in enumerate(images):
            if img_file.filename == '':
                continue
            ext = os.path.splitext(img_file.filename)[1] if img_file.filename else '.png'
            if not ext:
                ext = '.png'
            img_path = os.path.join(tmpdir, f'frame_{i:04d}{ext}')
            img_file.save(img_path)
            image_paths.append(img_path)

        if not image_paths:
            return jsonify({'error': 'No valid images provided'}), 400

        # Build ImageMagick command
        output_gif = os.path.join(tmpdir, 'output.gif')

        # Prepare frames: resize each image to target size
        resized_paths = []
        for i, img_path in enumerate(image_paths):
            resized_path = os.path.join(tmpdir, f'resized_{i:04d}.png')
            resize_cmd = ['convert', img_path, '-resize', f'{target_size}!', resized_path]
            result = subprocess.run(resize_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                return jsonify({'error': f'Failed to resize image: {result.stderr}'}), 500
            resized_paths.append(resized_path)

        # Build frames list (with optional reverted)
        frames = resized_paths[:]
        if append_reverted:
            frames = frames + list(reversed(resized_paths))

        # Build convert command for GIF
        cmd = ['convert', '-delay', str(delay_cs), '-loop', '0']
        cmd.extend(frames)
        cmd.append(output_gif)

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return jsonify({'error': f'Failed to create GIF: {result.stderr}'}), 500

        if not os.path.exists(output_gif):
            return jsonify({'error': 'GIF file was not created'}), 500

        return send_file(output_gif, mimetype='image/gif', as_attachment=True, download_name='output.gif')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)