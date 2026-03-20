import os
import tempfile
import subprocess
import shutil
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import re

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
MAX_FILES = 100

def allowed_file(filename):
    """Check if file has an allowed extension"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate target size format (e.g., '500x500')"""
    pattern = r'^\d+x\d+$'
    if not re.match(pattern, size_str):
        return False
    width, height = map(int, size_str.split('x'))
    # Reasonable limits
    if width < 1 or width > 5000 or height < 1 or height > 5000:
        return False
    return True

def validate_delay(delay):
    """Validate delay parameter"""
    if not isinstance(delay, int):
        return False
    if delay < 1 or delay > 10000:  # Max 10 seconds
        return False
    return True

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    output_file = None
    
    try:
        # Validate request has files
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        
        # Validate number of images
        if len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        if len(images) > MAX_FILES:
            return jsonify({'error': f'Too many images. Maximum is {MAX_FILES}'}), 400
        
        # Get and validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        if not validate_target_size(target_size):
            return jsonify({'error': 'Invalid targetSize format. Use format like "500x500"'}), 400
        
        # Get and validate delay
        delay = request.form.get('delay', '10')
        try:
            delay = int(delay)
        except ValueError:
            return jsonify({'error': 'delay must be an integer'}), 400
        
        if not validate_delay(delay):
            return jsonify({'error': 'Invalid delay. Must be between 1 and 10000 milliseconds'}), 400
        
        # Get appendReverted flag
        append_reverted = request.form.get('appendReverted', 'false').lower() in ['true', '1', 'yes']
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        
        # Save and validate uploaded images
        saved_files = []
        for idx, image in enumerate(images):
            if image.filename == '':
                continue
                
            # Check file extension
            if not allowed_file(image.filename):
                return jsonify({'error': f'Invalid file type for image {idx+1}'}), 400
            
            # Check file size
            image.seek(0, os.SEEK_END)
            file_size = image.tell()
            if file_size > MAX_FILE_SIZE:
                return jsonify({'error': f'Image {idx+1} exceeds maximum size of {MAX_FILE_SIZE} bytes'}), 400
            image.seek(0)
            
            # Save file with secure filename
            filename = secure_filename(f"image_{idx:04d}_{image.filename}")
            filepath = os.path.join(temp_dir, filename)
            image.save(filepath)
            saved_files.append(filepath)
        
        if len(saved_files) == 0:
            return jsonify({'error': 'No valid images were uploaded'}), 400
        
        # Prepare output file
        output_file = tempfile.NamedTemporaryFile(suffix='.gif', delete=False)
        output_file.close()
        
        # Build ImageMagick convert command
        cmd = ['convert']
        
        # Add delay (convert uses centiseconds, so divide by 10)
        delay_cs = max(1, delay // 10)
        cmd.extend(['-delay', str(delay_cs)])
        
        # Add resize option
        cmd.extend(['-resize', target_size])
        
        # Add loop option for GIF
        cmd.extend(['-loop', '0'])
        
        # Add all images
        cmd.extend(saved_files)
        
        # If appendReverted is true, add images in reverse order
        if append_reverted and len(saved_files) > 1:
            cmd.extend(reversed(saved_files[:-1]))  # Exclude last image to avoid duplication
        
        # Add output file
        cmd.append(output_file.name)
        
        # Execute convert command with timeout
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                check=True
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Image processing timeout'}), 500
        except subprocess.CalledProcessError as e:
            return jsonify({'error': f'Image processing failed: {e.stderr}'}), 500
        
        # Send the generated GIF
        return send_file(
            output_file.name,
            mimetype='image/gif',
            as_attachment=True,
            download_name='output.gif'
        )
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
        
    finally:
        # Cleanup temporary files
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass
        if output_file and os.path.exists(output_file.name):
            try:
                os.unlink(output_file.name)
            except:
                pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request entity too large'}), 413

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.config['MAX_CONTENT_LENGTH'] = MAX_FILES * MAX_FILE_SIZE
    app.run(host='0.0.0.0', port=5000, debug=False)