from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configure max file size (16MB)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if images are in the request
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get all image files
        images = request.files.getlist('images')
        
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        # Validate target size format
        try:
            width, height = target_size.split('x')
            int(width)
            int(height)
        except:
            return jsonify({'error': 'Invalid targetSize format. Use format: widthxheight (e.g., 500x500)'}), 400
        
        delay = request.form.get('delay', '10')
        try:
            delay = int(delay)
        except:
            return jsonify({'error': 'delay must be an integer'}), 400
        
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        
        try:
            # Save uploaded images to temp directory
            saved_images = []
            for i, image in enumerate(images):
                if image and allowed_file(image.filename):
                    filename = secure_filename(image.filename)
                    # Ensure unique filenames
                    base, ext = os.path.splitext(filename)
                    filename = f"{i:03d}_{base}{ext}"
                    filepath = os.path.join(temp_dir, filename)
                    image.save(filepath)
                    saved_images.append(filepath)
                else:
                    return jsonify({'error': f'Invalid or unsupported image file at index {i}'}), 400
            
            if not saved_images:
                return jsonify({'error': 'No valid images to process'}), 400
            
            # Prepare image list for conversion
            image_list = saved_images.copy()
            
            # If appendReverted is true, add reversed sequence
            if append_reverted:
                # Add images in reverse order (excluding the last one to avoid duplication)
                image_list.extend(reversed(saved_images[:-1]))
            
            # Create output GIF path
            output_gif = os.path.join(temp_dir, 'output.gif')
            
            # Build ImageMagick convert command
            cmd = ['convert']
            
            # Add delay (convert uses centiseconds, so divide by 10)
            cmd.extend(['-delay', str(delay // 10)])
            
            # Add all images
            cmd.extend(image_list)
            
            # Add resize option
            cmd.extend(['-resize', target_size])
            
            # Add loop option for infinite loop
            cmd.extend(['-loop', '0'])
            
            # Add output file
            cmd.append(output_gif)
            
            # Execute convert command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                error_msg = result.stderr if result.stderr else 'Unknown error during GIF creation'
                return jsonify({'error': f'Failed to create GIF: {error_msg}'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_gif):
                return jsonify({'error': 'GIF creation failed - output file not created'}), 500
            
            # Send the GIF file
            return send_file(
                output_gif,
                mimetype='image/gif',
                as_attachment=True,
                download_name='animated.gif'
            )
            
        finally:
            # Clean up temporary directory
            try:
                shutil.rmtree(temp_dir)
            except:
                pass
                
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large. Maximum total size is 16MB'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)