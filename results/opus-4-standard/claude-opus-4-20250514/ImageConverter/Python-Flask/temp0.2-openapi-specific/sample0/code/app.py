import os
import tempfile
import subprocess
import re
from flask import Flask, request, jsonify, send_file, make_response
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max request size

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(size_str):
    """Validate target size format and values"""
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, size_str)
    if not match:
        return None
    
    width, height = int(match.group(1)), int(match.group(2))
    
    # Limit dimensions to prevent resource exhaustion
    if width <= 0 or height <= 0 or width > 2000 or height > 2000:
        return None
    
    return f"{width}x{height}"

def validate_delay(delay):
    """Validate delay parameter"""
    try:
        delay_int = int(delay)
        # Limit delay range
        if delay_int < 10 or delay_int > 10000:
            return None
        return delay_int
    except (ValueError, TypeError):
        return None

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Check if images are in request
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        
        # Validate number of images
        if len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        if len(images) > 100:  # Limit number of images
            return jsonify({'error': 'Too many images provided'}), 400
        
        # Get and validate target size
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'Target size is required'}), 400
        
        validated_size = validate_target_size(target_size)
        if not validated_size:
            return jsonify({'error': 'Invalid target size format'}), 400
        
        # Get and validate delay
        delay = request.form.get('delay', 10)
        validated_delay = validate_delay(delay)
        if validated_delay is None:
            return jsonify({'error': 'Invalid delay value'}), 400
        
        # Get append reverted flag
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save and validate uploaded images
        saved_files = []
        for idx, image in enumerate(images):
            if image and allowed_file(image.filename):
                # Use secure filename with index to avoid conflicts
                filename = f"{idx:04d}_{secure_filename(image.filename)}"
                filepath = os.path.join(temp_dir, filename)
                
                # Save file
                image.save(filepath)
                
                # Verify it's actually an image using ImageMagick identify
                try:
                    result = subprocess.run(
                        ['identify', '-format', '%m', filepath],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if result.returncode != 0:
                        return jsonify({'error': 'Invalid image file'}), 400
                except subprocess.TimeoutExpired:
                    return jsonify({'error': 'Image validation timeout'}), 400
                except Exception:
                    return jsonify({'error': 'Image validation failed'}), 400
                
                saved_files.append(filepath)
            else:
                return jsonify({'error': 'Invalid file type'}), 400
        
        if not saved_files:
            return jsonify({'error': 'No valid images to process'}), 400
        
        # Prepare output file
        output_file = os.path.join(temp_dir, 'output.gif')
        
        # Build convert command
        cmd = ['convert', '-delay', str(validated_delay)]
        
        # Add resize option
        cmd.extend(['-resize', validated_size])
        
        # Add images
        cmd.extend(saved_files)
        
        # Add reverted images if requested
        if append_reverted:
            cmd.extend(reversed(saved_files))
        
        # Add output file
        cmd.append(output_file)
        
        # Execute convert command with timeout
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30  # 30 second timeout
            )
            
            if result.returncode != 0:
                # Don't expose internal error details
                return jsonify({'error': 'Failed to create GIF'}), 500
                
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timeout'}), 500
        except Exception:
            return jsonify({'error': 'GIF creation failed'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_file):
            return jsonify({'error': 'GIF creation failed'}), 500
        
        # Send file with security headers
        response = make_response(send_file(
            output_file,
            mimetype='image/gif',
            as_attachment=True,
            download_name='created.gif'
        ))
        
        # Add security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'"
        
        return response
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'Request too large'}), 400
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                for file in os.listdir(temp_dir):
                    os.remove(os.path.join(temp_dir, file))
                os.rmdir(temp_dir)
            except:
                pass

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)