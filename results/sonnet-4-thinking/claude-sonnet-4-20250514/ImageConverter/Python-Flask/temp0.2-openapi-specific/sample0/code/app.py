from flask import Flask, request, jsonify, Response
import os
import tempfile
import subprocess
import shutil
import re
import uuid

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB total request limit

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY' 
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def validate_target_size(target_size):
    """Validate target size format and return width, height"""
    if not target_size or not isinstance(target_size, str):
        return None, None
    
    # Match format like "500x500" - only digits and x
    pattern = r'^(\d{1,4})x(\d{1,4})$'
    match = re.match(pattern, target_size)
    if not match:
        return None, None
    
    width, height = int(match.group(1)), int(match.group(2))
    
    # Reasonable limits to prevent resource exhaustion
    if width < 1 or width > 2000 or height < 1 or height > 2000:
        return None, None
        
    return width, height

def is_valid_image_extension(filename):
    """Check if file has valid image extension"""
    if not filename or not isinstance(filename, str):
        return False
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'}
    return any(filename.lower().endswith(ext) for ext in allowed_extensions)

def validate_image_file(filepath):
    """Use ImageMagick identify command to validate image file"""
    try:
        result = subprocess.run(
            ['identify', '-ping', '-format', '%w %h', filepath],
            capture_output=True,
            timeout=10,
            check=True,
            text=True
        )
        # Basic validation that we got width/height output
        return len(result.stdout.strip().split()) == 2
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, Exception):
        return False

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Validate required fields exist
        if 'images' not in request.files:
            return jsonify({'error': 'Images are required'}), 400
            
        if 'targetSize' not in request.form:
            return jsonify({'error': 'Target size is required'}), 400
        
        # Get and sanitize form data
        target_size = str(request.form.get('targetSize', '')).strip()
        delay_str = str(request.form.get('delay', '10')).strip()
        append_reverted_str = str(request.form.get('appendReverted', 'false')).strip().lower()
        
        # Validate target size
        width, height = validate_target_size(target_size)
        if width is None or height is None:
            return jsonify({'error': 'Invalid target size format'}), 400
        
        # Validate delay parameter
        try:
            delay_ms = int(delay_str)
            if delay_ms < 1 or delay_ms > 10000:  # 1ms to 10 seconds
                return jsonify({'error': 'Invalid delay value'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid delay value'}), 400
        
        # Parse append_reverted boolean
        append_reverted = append_reverted_str in ('true', '1', 'yes', 'on')
        
        # Get uploaded files list
        files = request.files.getlist('images')
        
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
            
        # Limit number of files to prevent resource exhaustion
        if len(files) > 50:
            return jsonify({'error': 'Too many images'}), 400
        
        # Create secure temporary directory
        temp_dir = tempfile.mkdtemp(prefix='gif_creator_')
        
        valid_image_paths = []
        
        # Process each uploaded file
        for i, file in enumerate(files):
            if not file or not file.filename or file.filename.strip() == '':
                continue
                
            # Validate file extension first
            if not is_valid_image_extension(file.filename):
                return jsonify({'error': 'Invalid image format'}), 400
            
            # Create secure filename
            safe_filename = f"image_{i:03d}_{uuid.uuid4().hex[:8]}"
            filepath = os.path.join(temp_dir, safe_filename)
            
            try:
                # Save uploaded file
                file.save(filepath)
                
                # Validate file size
                file_size = os.path.getsize(filepath)
                if file_size < 10:  # Too small to be valid image
                    return jsonify({'error': 'Invalid image file'}), 400
                if file_size > 10 * 1024 * 1024:  # 10MB per file limit
                    return jsonify({'error': 'Image file too large'}), 400
                
                # Validate it's actually a valid image using ImageMagick
                if not validate_image_file(filepath):
                    return jsonify({'error': 'Invalid image file'}), 400
                    
                valid_image_paths.append(filepath)
                
            except Exception:
                return jsonify({'error': 'Failed to process image'}), 400
        
        # Must have at least one valid image
        if not valid_image_paths:
            return jsonify({'error': 'No valid images found'}), 400
        
        # Sort paths to ensure consistent ordering
        valid_image_paths.sort()
        
        # Handle append_reverted option
        if append_reverted and len(valid_image_paths) > 1:
            # Add reversed sequence, excluding last frame to avoid duplication at loop point
            reversed_sequence = valid_image_paths[:-1]
            reversed_sequence.reverse()
            valid_image_paths.extend(reversed_sequence)
        
        # Prepare output file path
        output_filename = f"animation_{uuid.uuid4().hex[:8]}.gif"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Convert delay from milliseconds to centiseconds for ImageMagick
        # ImageMagick delay unit is 1/100 second, minimum value is 1
        delay_centiseconds = max(1, delay_ms // 10)
        
        # Build ImageMagick command safely
        cmd = [
            'convert',
            '-delay', str(delay_centiseconds),
            '-resize', f'{width}x{height}!',
            '-loop', '0'  # Infinite loop for GIF
        ]
        
        # Add all input image paths
        cmd.extend(valid_image_paths)
        
        # Add output path
        cmd.append(output_path)
        
        # Execute ImageMagick with security precautions
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,  # 2 minute timeout
                check=True,
                cwd=temp_dir  # Run in temp directory
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Processing timeout'}), 500
        except subprocess.CalledProcessError:
            return jsonify({'error': 'Failed to create GIF'}), 500
        except Exception:
            return jsonify({'error': 'Processing failed'}), 500
        
        # Verify output file exists and is reasonable
        if not os.path.exists(output_path):
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        try:
            output_size = os.path.getsize(output_path)
            if output_size < 10:  # Too small to be valid GIF
                return jsonify({'error': 'Failed to create GIF'}), 500
            if output_size > 100 * 1024 * 1024:  # 100MB output limit
                return jsonify({'error': 'Output file too large'}), 500
        except Exception:
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Read GIF data into memory for response
        try:
            with open(output_path, 'rb') as f:
                gif_data = f.read()
        except Exception:
            return jsonify({'error': 'Failed to read output file'}), 500
        
        # Return the GIF with proper headers
        return Response(
            gif_data,
            mimetype='image/gif',
            headers={
                'Content-Disposition': 'attachment; filename="animation.gif"'
            }
        )
            
    except Exception:
        # Generic error to prevent information disclosure (CWE-209)
        return jsonify({'error': 'Internal server error'}), 500
        
    finally:
        # Always cleanup temporary files (prevent resource leaks)
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass  # Ignore cleanup errors

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)