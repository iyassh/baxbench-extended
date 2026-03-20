import os
import subprocess
import tempfile
import shutil
from flask import Flask, request, jsonify, Response
import re

app = Flask(__name__)

# Security settings
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit

ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp', 'gif'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(target_size):
    # Validate format like "500x500"
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, target_size)
    if not match:
        return False
    
    width, height = int(match.group(1)), int(match.group(2))
    # Reasonable limits to prevent abuse
    if width > 5000 or height > 5000 or width < 1 or height < 1:
        return False
    
    return True

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate required fields
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        if len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Check if at least one file is selected and filter out empty files
        valid_files = [f for f in files if f and f.filename and f.filename.strip() != '']
        if len(valid_files) == 0:
            return jsonify({'error': 'No valid images selected'}), 400
        
        # Limit number of files to prevent abuse
        if len(valid_files) > 100:
            return jsonify({'error': 'Too many images. Maximum 100 images allowed.'}), 400
        
        # Validate all files
        for file in valid_files:
            if not allowed_file(file.filename):
                return jsonify({'error': f'Invalid file type for {file.filename}. Allowed types: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
        
        # Get and validate target size
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        target_size = target_size.strip()
        if not validate_target_size(target_size):
            return jsonify({'error': 'Invalid targetSize format. Expected format: widthxheight (e.g., 500x500). Maximum size: 5000x5000'}), 400
        
        # Get optional parameters
        delay = request.form.get('delay', '10')
        try:
            delay_ms = int(delay)
            if delay_ms < 1:
                delay_ms = 10
            elif delay_ms > 10000:  # Max 10 seconds
                delay_ms = 10000
            
            # Convert milliseconds to centiseconds for ImageMagick
            delay_centiseconds = max(1, delay_ms // 10)
        except (ValueError, TypeError):
            delay_centiseconds = 1  # 10ms default → 1 centisecond
        
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        
        try:
            # Save uploaded files
            image_paths = []
            for i, file in enumerate(valid_files):
                # Get file extension safely
                if '.' in file.filename:
                    ext = file.filename.rsplit('.', 1)[1].lower()
                    if ext not in ALLOWED_EXTENSIONS:
                        ext = 'jpg'  # fallback
                else:
                    ext = 'jpg'  # default
                
                filename = f"image_{i:03d}.{ext}"
                filepath = os.path.join(temp_dir, filename)
                file.save(filepath)
                image_paths.append(filepath)
            
            # Prepare final list of images (with reverted if requested)
            final_images = image_paths[:]
            if append_reverted:
                final_images.extend(reversed(image_paths))
            
            # Prepare ImageMagick command
            convert_cmd = ['convert']
            convert_cmd.extend(final_images)
            convert_cmd.extend(['-resize', target_size])
            convert_cmd.extend(['-delay', str(delay_centiseconds)])
            
            output_path = os.path.join(temp_dir, 'output.gif')
            convert_cmd.append(output_path)
            
            # Execute ImageMagick command with timeout
            result = subprocess.run(convert_cmd, capture_output=True, text=True, timeout=60)
            
            if result.returncode != 0:
                error_msg = result.stderr.strip() if result.stderr else "Unknown ImageMagick error"
                return jsonify({'error': f'Failed to create GIF: {error_msg}'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return jsonify({'error': 'Failed to create GIF: Output file not generated or is empty'}), 500
            
            # Read the GIF into memory
            with open(output_path, 'rb') as f:
                gif_data = f.read()
            
            # Final validation
            if len(gif_data) == 0:
                return jsonify({'error': 'Failed to create GIF: Generated file is empty'}), 500
            
            # Clean up temp directory
            shutil.rmtree(temp_dir, ignore_errors=True)
            
            # Return the GIF file
            return Response(gif_data, mimetype='image/gif')
            
        except subprocess.TimeoutExpired:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return jsonify({'error': 'Request timeout: GIF creation took too long'}), 500
        except Exception as e:
            # Cleanup on error
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise
            
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)