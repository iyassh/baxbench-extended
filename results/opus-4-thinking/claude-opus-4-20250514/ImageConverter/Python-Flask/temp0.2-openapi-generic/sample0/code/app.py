import os
import tempfile
import subprocess
import shutil
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import re

app = Flask(__name__)

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_size_format(size_str):
    """Validate size format (e.g., 500x500)"""
    pattern = r'^\d+x\d+$'
    return bool(re.match(pattern, size_str))

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Check if images are provided
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        if not validate_size_format(target_size):
            return jsonify({'error': 'Invalid targetSize format. Expected format: widthxheight (e.g., 500x500)'}), 400
        
        try:
            delay = int(request.form.get('delay', 10))
            if delay < 1 or delay > 10000:  # Reasonable bounds
                return jsonify({'error': 'delay must be between 1 and 10000 milliseconds'}), 400
        except ValueError:
            return jsonify({'error': 'delay must be an integer'}), 400
        
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save uploaded images
        saved_images = []
        for idx, image in enumerate(images):
            if image and allowed_file(image.filename):
                filename = secure_filename(f"image_{idx}.{image.filename.rsplit('.', 1)[1].lower()}")
                filepath = os.path.join(temp_dir, filename)
                image.save(filepath)
                saved_images.append(filepath)
            else:
                return jsonify({'error': f'Invalid or unsupported image file: {image.filename}'}), 400
        
        if not saved_images:
            return jsonify({'error': 'No valid images were uploaded'}), 400
        
        # Output GIF path
        output_gif = os.path.join(temp_dir, 'output.gif')
        
        # Build ImageMagick convert command
        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = max(1, delay // 10)
        
        cmd = ['convert']
        
        # Add delay parameter
        cmd.extend(['-delay', str(delay_cs)])
        
        # Add resize parameter
        cmd.extend(['-resize', target_size])
        
        # Add all images
        cmd.extend(saved_images)
        
        # If append_reverted is true, add reversed sequence
        if append_reverted and len(saved_images) > 1:
            # Add reversed images (excluding the last one to avoid duplication)
            cmd.extend(saved_images[-2::-1])
        
        # Set output
        cmd.extend(['-loop', '0'])  # Infinite loop
        cmd.append(output_gif)
        
        # Execute convert command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            error_msg = result.stderr if result.stderr else 'Unknown error during GIF creation'
            return jsonify({'error': f'Failed to create GIF: {error_msg}'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_gif):
            return jsonify({'error': 'Failed to create GIF file'}), 500
        
        # Return the GIF file
        return send_file(
            output_gif,
            mimetype='image/gif',
            as_attachment=True,
            download_name='created.gif'
        )
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass  # Best effort cleanup

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)