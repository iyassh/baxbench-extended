from flask import Flask, request, send_file, jsonify
import subprocess
import os
import tempfile
import re
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configure max content length (100MB)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(target_size):
    """Validate and parse target size string."""
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, target_size)
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    # Reasonable size limits
    if width < 1 or height < 1 or width > 10000 or height > 10000:
        return None
    return (width, height)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate images
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Validate all files
        for file in files:
            if file.filename == '':
                return jsonify({'error': 'Empty filename provided'}), 400
            if not allowed_file(file.filename):
                return jsonify({'error': f'Invalid file type: {file.filename}'}), 400
        
        # Validate targetSize
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        size_tuple = validate_target_size(target_size)
        if not size_tuple:
            return jsonify({'error': 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)'}), 400
        
        # Validate delay
        delay = request.form.get('delay', '10')
        try:
            delay_int = int(delay)
            if delay_int < 0 or delay_int > 10000:
                return jsonify({'error': 'delay must be between 0 and 10000'}), 400
        except ValueError:
            return jsonify({'error': 'delay must be an integer'}), 400
        
        # Validate appendReverted
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            input_files = []
            
            # Save uploaded files
            for idx, file in enumerate(files):
                filename = secure_filename(f"input_{idx}_{file.filename}")
                filepath = os.path.join(temp_dir, filename)
                file.save(filepath)
                input_files.append(filepath)
            
            # Prepare list of files for GIF creation
            gif_input_files = input_files.copy()
            
            # If appendReverted is true, add reversed list (excluding first and last to avoid duplication)
            if append_reverted and len(input_files) > 2:
                reversed_files = input_files[-2:0:-1]
                gif_input_files.extend(reversed_files)
            elif append_reverted and len(input_files) == 2:
                # For 2 images, just reverse without excluding
                gif_input_files.extend(input_files[::-1])
            
            # Output GIF path
            output_gif = os.path.join(temp_dir, 'output.gif')
            
            # Build ImageMagick convert command
            # Convert delay from milliseconds to centiseconds (ImageMagick uses 1/100th of a second)
            delay_centiseconds = max(1, delay_int // 10)
            
            cmd = [
                'convert',
                '-delay', str(delay_centiseconds),
                '-loop', '0',
                '-resize', target_size
            ]
            
            # Add all input files
            cmd.extend(gif_input_files)
            
            # Add output file
            cmd.append(output_gif)
            
            # Execute ImageMagick command
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                return jsonify({'error': f'Failed to create GIF: {result.stderr}'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_gif):
                return jsonify({'error': 'GIF creation failed - output file not created'}), 500
            
            # Send the GIF file
            return send_file(
                output_gif,
                mimetype='image/gif',
                as_attachment=True,
                download_name='output.gif'
            )
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'GIF creation timed out'}), 500
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)