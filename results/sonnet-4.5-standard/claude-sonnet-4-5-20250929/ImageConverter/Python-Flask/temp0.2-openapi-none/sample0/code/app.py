<CODE>
from flask import Flask, request, send_file, jsonify
import subprocess
import os
import tempfile
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

def parse_target_size(target_size_str):
    """Parse target size string like '500x500' into width and height."""
    try:
        parts = target_size_str.lower().split('x')
        if len(parts) != 2:
            return None, None
        width = int(parts[0])
        height = int(parts[1])
        return width, height
    except (ValueError, AttributeError):
        return None, None

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate request
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        width, height = parse_target_size(target_size)
        if width is None or height is None:
            return jsonify({'error': 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)'}), 400
        
        try:
            delay = int(request.form.get('delay', 10))
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid delay value. Must be an integer'}), 400
        
        append_reverted_str = request.form.get('appendReverted', 'false').lower()
        append_reverted = append_reverted_str in ['true', '1', 'yes']
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save uploaded images
        image_paths = []
        for idx, image in enumerate(images):
            if image.filename == '':
                continue
            
            filename = secure_filename(f"image_{idx}_{image.filename}")
            filepath = os.path.join(temp_dir, filename)
            image.save(filepath)
            image_paths.append(filepath)
        
        if not image_paths:
            return jsonify({'error': 'No valid images provided'}), 400
        
        # If append_reverted is True, add reversed images (excluding first and last to avoid duplication)
        if append_reverted and len(image_paths) > 1:
            reversed_paths = list(reversed(image_paths[1:-1]))
            image_paths.extend(reversed_paths)
        
        # Output GIF path
        output_gif = os.path.join(temp_dir, 'output.gif')
        
        # Build ImageMagick convert command
        # delay is in milliseconds, ImageMagick uses 1/100th of a second
        # So we need to convert: delay_ms / 10 = delay in 1/100th seconds
        imagemagick_delay = delay // 10
        if imagemagick_delay < 1:
            imagemagick_delay = 1
        
        cmd = ['convert', '-delay', str(imagemagick_delay), '-loop', '0']
        
        # Add resize parameter for each image
        for img_path in image_paths:
            cmd.extend([img_path, '-resize', f'{width}x{height}!'])
        
        cmd.append(output_gif)
        
        # Execute ImageMagick command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            error_msg = result.stderr if result.stderr else 'Failed to create GIF'
            return jsonify({'error': f'ImageMagick error: {error_msg}'}), 500
        
        if not os.path.exists(output_gif):
            return jsonify({'error': 'Failed to create GIF file'}), 500
        
        # Send the GIF file
        return send_file(
            output_gif,
            mimetype='image/gif',
            as_attachment=False,
            download_name='output.gif'
        )
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>