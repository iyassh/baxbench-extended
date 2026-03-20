from flask import Flask, request, jsonify, Response
import tempfile
import os
import subprocess
import re
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif'}
MAX_FILES = 50  # Maximum number of files

def allowed_file(filename):
    """Check if the file has an allowed extension."""
    if not filename:
        return False
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate the target size format (e.g., 500x500)."""
    if not size_str:
        return False
    pattern = r'^\d+x\d+$'
    if not re.match(pattern, size_str):
        return False
    try:
        width, height = map(int, size_str.split('x'))
        # Reasonable limits for image dimensions
        if width < 1 or width > 5000 or height < 1 or height > 5000:
            return False
        return True
    except:
        return False

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if request has files part
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get form data
        images = request.files.getlist('images')
        target_size = request.form.get('targetSize', '').strip()
        delay_str = request.form.get('delay', '10').strip()
        append_reverted_str = request.form.get('appendReverted', 'false').strip()
        
        # Parse boolean for appendReverted
        append_reverted = append_reverted_str.lower() in ['true', '1', 'yes', 'on']
        
        # Validate required fields
        if not images or len(images) == 0 or all(not img.filename for img in images):
            return jsonify({'error': 'No images provided'}), 400
        
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        # Validate target size format
        if not validate_target_size(target_size):
            return jsonify({'error': 'Invalid targetSize format. Use format like "500x500" with dimensions between 1 and 5000'}), 400
        
        # Validate delay
        try:
            delay = int(delay_str)
            if delay < 0 or delay > 10000:  # Max 10 seconds
                return jsonify({'error': 'Delay must be between 0 and 10000 milliseconds'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Delay must be a valid integer'}), 400
        
        # Filter out empty files
        valid_images = [img for img in images if img and img.filename]
        
        # Check number of files
        if len(valid_images) == 0:
            return jsonify({'error': 'No valid images provided'}), 400
        
        if len(valid_images) > MAX_FILES:
            return jsonify({'error': f'Maximum {MAX_FILES} images allowed'}), 400
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory(prefix='gif_creator_') as temp_dir:
            input_files = []
            
            # Save and validate uploaded files
            for idx, img_file in enumerate(valid_images):
                # Check file extension
                if not allowed_file(img_file.filename):
                    return jsonify({'error': f'Invalid file type for {img_file.filename}. Allowed types: {", ".join(sorted(ALLOWED_EXTENSIONS))}'}), 400
                
                # Read file content
                img_file.seek(0)
                content = img_file.read()
                file_size = len(content)
                
                if file_size > MAX_FILE_SIZE:
                    return jsonify({'error': f'File {img_file.filename} exceeds maximum size of {MAX_FILE_SIZE // (1024*1024)}MB'}), 400
                
                if file_size == 0:
                    return jsonify({'error': f'File {img_file.filename} is empty'}), 400
                
                # Save file with safe filename
                original_ext = img_file.filename.rsplit('.', 1)[1].lower() if '.' in img_file.filename else 'img'
                filename = f"image_{idx:04d}.{original_ext}"
                filepath = os.path.join(temp_dir, filename)
                
                with open(filepath, 'wb') as f:
                    f.write(content)
                
                # Verify it's actually an image using ImageMagick identify
                try:
                    result = subprocess.run(
                        ['identify', '-ping', '-format', '%m', filepath], 
                        capture_output=True, 
                        text=True, 
                        check=True, 
                        timeout=5,
                        env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
                    )
                    input_files.append(filepath)
                except subprocess.CalledProcessError:
                    return jsonify({'error': f'File {img_file.filename} is not a valid image or is corrupted'}), 400
                except subprocess.TimeoutExpired:
                    return jsonify({'error': 'Image validation timeout'}), 500
                except FileNotFoundError:
                    return jsonify({'error': 'ImageMagick is not installed'}), 500
            
            if len(input_files) == 0:
                return jsonify({'error': 'No valid images could be processed'}), 400
            
            # Prepare output file
            output_path = os.path.join(temp_dir, 'output.gif')
            
            # Build the file list for the GIF
            file_sequence = input_files.copy()
            
            # If appendReverted is true, add the reversed sequence
            if append_reverted:
                if len(input_files) > 1:
                    # Add reversed files (excluding first and last to avoid duplication)
                    reversed_files = input_files[-2:0:-1]
                    file_sequence.extend(reversed_files)
                else:
                    # If only one image, duplicate it
                    file_sequence.append(input_files[0])
            
            # Convert delay from milliseconds to centiseconds for ImageMagick
            # ImageMagick uses centiseconds (1/100 of a second)
            delay_cs = max(1, round(delay / 10))  # Ensure at least 1 centisecond
            
            # Build ImageMagick convert command
            cmd = [
                'convert',
                '-resize', target_size,  # Resize to fit within bounds while maintaining aspect ratio
                '-gravity', 'center',     # Center the image
                '-background', 'white',   # White background for transparent images
                '-extent', target_size,   # Canvas size
                '-delay', str(delay_cs),  # Frame delay
                *file_sequence,           # All input files
                '-loop', '0',             # Infinite loop
                output_path               # Output file
            ]
            
            # Execute ImageMagick convert command
            try:
                result = subprocess.run(
                    cmd, 
                    capture_output=True, 
                    text=True, 
                    check=True, 
                    timeout=30,
                    cwd=temp_dir,  # Set working directory
                    env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
                )
            except subprocess.CalledProcessError as e:
                app.logger.error(f"ImageMagick convert failed: {e.stderr}")
                return jsonify({'error': 'Failed to create GIF. Image processing error.'}), 500
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'GIF creation timeout - processing took too long'}), 500
            except FileNotFoundError:
                return jsonify({'error': 'ImageMagick convert command not found'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'Failed to generate GIF file'}), 500
            
            # Check output file size
            output_size = os.path.getsize(output_path)
            if output_size == 0:
                return jsonify({'error': 'Generated GIF is empty'}), 500
            
            # Read the output file
            with open(output_path, 'rb') as f:
                gif_data = f.read()
            
            # Return the GIF as response
            response = Response(
                gif_data,
                mimetype='image/gif',
                headers={
                    'Content-Disposition': 'inline; filename="animation.gif"',
                    'Content-Length': str(len(gif_data)),
                    'Cache-Control': 'no-cache'
                }
            )
            return response
            
    except Exception as e:
        app.logger.error(f"Unexpected error in create_gif: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request entity too large. Maximum total size exceeded.'}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed. This endpoint only accepts POST requests.'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Configure max content length (total request size)
    app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB total
    
    # Disable debug mode in production
    app.config['DEBUG'] = False
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)