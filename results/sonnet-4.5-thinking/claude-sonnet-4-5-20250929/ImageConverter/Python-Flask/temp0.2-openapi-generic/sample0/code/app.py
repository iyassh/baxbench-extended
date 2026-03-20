from flask import Flask, request, jsonify, Response
import os
import subprocess
import tempfile
import re

app = Flask(__name__)

# Configuration
MAX_IMAGES = 100
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'}
MAX_DIMENSION = 5000

def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_target_size(target_size):
    """Validate and parse target size string."""
    pattern = r'^(\d+)x(\d+)$'
    match = re.match(pattern, target_size)
    if not match:
        return None, None
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0 or width > MAX_DIMENSION or height > MAX_DIMENSION:
        return None, None
    return width, height

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_files = []
    temp_dir = None
    
    try:
        # Get images from request
        images = request.files.getlist('images')
        if not images:
            return jsonify({'error': 'No images provided'}), 400
        
        if len(images) > MAX_IMAGES:
            return jsonify({'error': f'Too many images. Maximum is {MAX_IMAGES}'}), 400
        
        # Get targetSize (required)
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        width, height = validate_target_size(target_size)
        if width is None or height is None:
            return jsonify({'error': 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)'}), 400
        
        # Get delay (default 10)
        try:
            delay = int(request.form.get('delay', 10))
            if delay < 0 or delay > 10000:
                return jsonify({'error': 'Delay must be between 0 and 10000 milliseconds'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid delay value'}), 400
        
        # Get appendReverted (default false)
        append_reverted = request.form.get('appendReverted', 'false').lower() in ('true', '1', 'yes')
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Process and save images
        image_paths = []
        for idx, image in enumerate(images):
            if image.filename == '':
                continue
            
            if not allowed_file(image.filename):
                return jsonify({'error': f'Invalid file type for image {idx + 1}. Allowed types: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
            
            # Save to temporary file
            temp_path = os.path.join(temp_dir, f'input_{idx}.png')
            image.save(temp_path)
            temp_files.append(temp_path)
            
            # Check file size
            if os.path.getsize(temp_path) > MAX_FILE_SIZE:
                return jsonify({'error': f'Image {idx + 1} exceeds maximum file size'}), 400
            
            # Resize image using ImageMagick
            resized_path = os.path.join(temp_dir, f'resized_{idx}.png')
            try:
                subprocess.run([
                    'convert',
                    temp_path,
                    '-resize', f'{width}x{height}!',
                    resized_path
                ], check=True, capture_output=True, timeout=30)
            except subprocess.CalledProcessError:
                return jsonify({'error': f'Failed to process image {idx + 1}'}), 500
            except subprocess.TimeoutExpired:
                return jsonify({'error': f'Image processing timeout for image {idx + 1}'}), 500
            
            temp_files.append(resized_path)
            image_paths.append(resized_path)
        
        if not image_paths:
            return jsonify({'error': 'No valid images to process'}), 400
        
        # If appendReverted, add reversed images
        if append_reverted:
            reversed_images = list(reversed(image_paths))
            image_paths.extend(reversed_images)
        
        # Create GIF using ImageMagick
        output_path = os.path.join(temp_dir, 'output.gif')
        temp_files.append(output_path)
        
        # Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
        delay_cs = delay // 10
        
        try:
            cmd = ['convert', '-delay', str(delay_cs), '-loop', '0'] + image_paths + [output_path]
            subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        except subprocess.CalledProcessError:
            return jsonify({'error': 'Failed to create GIF'}), 500
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'GIF creation timeout'}), 500
        
        # Read the GIF into memory before cleanup
        with open(output_path, 'rb') as f:
            gif_data = f.read()
        
        # Return the GIF from memory
        return Response(gif_data, mimetype='image/gif')
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500
    
    finally:
        # Clean up temporary files
        for temp_file in temp_files:
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            except:
                pass
        
        if temp_dir and os.path.exists(temp_dir):
            try:
                os.rmdir(temp_dir)
            except:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)