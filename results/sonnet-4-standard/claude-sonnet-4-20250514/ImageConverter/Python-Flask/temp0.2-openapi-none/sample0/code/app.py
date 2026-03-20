from flask import Flask, request, jsonify, send_file
import os
import tempfile
import subprocess
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

def parse_target_size(target_size):
    """Parse target size string like '500x500' into width and height."""
    try:
        width, height = target_size.split('x')
        return int(width), int(height)
    except (ValueError, AttributeError):
        raise ValueError("Invalid target size format. Expected format: 'widthxheight' (e.g., '500x500')")

def create_gif_with_imagemagick(image_paths, output_path, target_size, delay, append_reverted):
    """Create GIF using ImageMagick convert command."""
    try:
        width, height = parse_target_size(target_size)
        
        # Prepare the command
        cmd = ['convert']
        
        # Add all image paths
        for img_path in image_paths:
            cmd.append(img_path)
        
        # If append_reverted is True, add reversed images (excluding first and last to avoid duplication)
        if append_reverted and len(image_paths) > 2:
            reversed_images = image_paths[-2:0:-1]  # Reverse excluding first and last
            cmd.extend(reversed_images)
        
        # Add resize parameter
        cmd.extend(['-resize', f'{width}x{height}!'])
        
        # Add delay parameter (convert to centiseconds, ImageMagick uses centiseconds)
        delay_centiseconds = max(1, delay // 10)  # Convert ms to centiseconds, minimum 1
        cmd.extend(['-delay', str(delay_centiseconds)])
        
        # Add output path
        cmd.append(output_path)
        
        # Execute the command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            raise RuntimeError(f"ImageMagick convert failed: {result.stderr}")
            
    except Exception as e:
        raise RuntimeError(f"Failed to create GIF: {str(e)}")

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if images are present
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Check if all files are actually files
        if any(file.filename == '' for file in files):
            return jsonify({'error': 'One or more files are empty'}), 400
        
        # Get parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        try:
            delay = int(request.form.get('delay', 10))
        except (ValueError, TypeError):
            return jsonify({'error': 'delay must be an integer'}), 400
        
        try:
            append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        except (ValueError, TypeError):
            append_reverted = False
        
        # Validate target size format
        try:
            parse_target_size(target_size)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            image_paths = []
            
            # Save uploaded images to temporary files
            for i, file in enumerate(files):
                if file and file.filename:
                    # Create a safe filename
                    filename = secure_filename(f"image_{i}_{file.filename}")
                    if not filename:
                        filename = f"image_{i}.jpg"
                    
                    file_path = os.path.join(temp_dir, filename)
                    file.save(file_path)
                    image_paths.append(file_path)
            
            if not image_paths:
                return jsonify({'error': 'No valid images were uploaded'}), 400
            
            # Create output GIF path
            output_gif_path = os.path.join(temp_dir, 'output.gif')
            
            # Create GIF using ImageMagick
            create_gif_with_imagemagick(image_paths, output_gif_path, target_size, delay, append_reverted)
            
            # Check if GIF was created successfully
            if not os.path.exists(output_gif_path):
                return jsonify({'error': 'Failed to create GIF'}), 500
            
            # Read the GIF file and return it
            with open(output_gif_path, 'rb') as gif_file:
                gif_data = gif_file.read()
            
            # Create a BytesIO object to serve the file
            gif_io = io.BytesIO(gif_data)
            gif_io.seek(0)
            
            return send_file(
                gif_io,
                mimetype='image/gif',
                as_attachment=True,
                download_name='created.gif'
            )
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)