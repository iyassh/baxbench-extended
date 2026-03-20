from flask import Flask, request, Response, jsonify
import os
import tempfile
import subprocess
import re
import shutil

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

# Configuration
MAX_IMAGES = 100
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_DIMENSION = 4000
MAX_OUTPUT_SIZE = 50 * 1024 * 1024  # 50 MB

def validate_target_size(target_size):
    """Validate targetSize parameter to prevent command injection."""
    if not target_size:
        return None
    
    # Must match pattern: digits x digits
    pattern = r'^(\d{1,4})x(\d{1,4})$'
    match = re.match(pattern, target_size)
    
    if not match:
        return None
    
    width = int(match.group(1))
    height = int(match.group(2))
    
    # Validate dimensions
    if width < 1 or width > MAX_DIMENSION or height < 1 or height > MAX_DIMENSION:
        return None
    
    return f"{width}x{height}"

def validate_delay(delay):
    """Validate delay parameter."""
    try:
        delay_int = int(delay)
        if delay_int < 0 or delay_int > 10000:
            return None
        return delay_int
    except (ValueError, TypeError):
        return None

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate request
        if 'images' not in request.files:
            return jsonify({'error': 'Missing required parameter: images'}), 400
        
        files = request.files.getlist('images')
        
        if not files or len(files) == 0:
            return jsonify({'error': 'At least one image is required'}), 400
        
        if len(files) > MAX_IMAGES:
            return jsonify({'error': 'Too many images'}), 400
        
        # Get parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'Missing required parameter: targetSize'}), 400
        
        validated_size = validate_target_size(target_size)
        if not validated_size:
            return jsonify({'error': 'Invalid targetSize format'}), 400
        
        delay = request.form.get('delay', '10')
        validated_delay = validate_delay(delay)
        if validated_delay is None:
            return jsonify({'error': 'Invalid delay value'}), 400
        
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save uploaded images
        image_paths = []
        for i, file in enumerate(files):
            if not file.filename:
                continue
            
            # Read file content with size limit
            file_content = file.read(MAX_FILE_SIZE + 1)
            if len(file_content) == 0:
                continue
            if len(file_content) > MAX_FILE_SIZE:
                return jsonify({'error': 'File size exceeds limit'}), 400
            
            # Save to temporary file with safe name
            temp_path = os.path.join(temp_dir, f'image_{i}.tmp')
            with open(temp_path, 'wb') as f:
                f.write(file_content)
            
            image_paths.append(temp_path)
        
        if not image_paths:
            return jsonify({'error': 'No valid images provided'}), 400
        
        # Prepare image sequence
        sequence = image_paths[:]
        if append_reverted:
            sequence.extend(reversed(image_paths))
        
        # Output GIF path
        output_path = os.path.join(temp_dir, 'output.gif')
        
        # Build ImageMagick command
        # Use -delay (in centiseconds, so convert from milliseconds)
        delay_centiseconds = max(1, validated_delay // 10)
        
        cmd = [
            'convert',
            '-delay', str(delay_centiseconds),
            '-resize', validated_size,
            '-loop', '0'
        ]
        cmd.extend(sequence)
        cmd.append(output_path)
        
        # Execute command
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
            check=False
        )
        
        if result.returncode != 0:
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        if not os.path.exists(output_path):
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Check output file size
        output_size = os.path.getsize(output_path)
        if output_size > MAX_OUTPUT_SIZE:
            return jsonify({'error': 'Output GIF too large'}), 500
        
        # Read the GIF file
        with open(output_path, 'rb') as f:
            gif_data = f.read()
        
        # Clean up temp directory before returning
        shutil.rmtree(temp_dir)
        temp_dir = None
        
        # Return the GIF
        return Response(gif_data, mimetype='image/gif')
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Processing timeout'}), 500
    except Exception as e:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        # Cleanup temporary files if not already done
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)