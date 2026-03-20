import os
import subprocess
import tempfile
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size


def validate_size_format(size_str):
    """Validate and parse size string in format 'WIDTHxHEIGHT'"""
    try:
        parts = size_str.lower().split('x')
        if len(parts) != 2:
            return None
        width, height = int(parts[0]), int(parts[1])
        if width <= 0 or height <= 0:
            return None
        return f"{width}x{height}"
    except (ValueError, AttributeError):
        return None


def create_gif_from_images(image_paths, target_size, delay, append_reverted):
    """Create a GIF from a list of image paths using ImageMagick"""
    try:
        # Prepare the list of images for the GIF
        frames = image_paths.copy()
        
        # Append reverted frames if requested
        if append_reverted:
            frames.extend(reversed(image_paths))
        
        # Create output GIF using ImageMagick convert command
        output_gif = tempfile.NamedTemporaryFile(suffix='.gif', delete=False)
        output_path = output_gif.name
        output_gif.close()
        
        # Build the convert command
        cmd = [
            'convert',
            '-delay', str(delay // 10),  # ImageMagick uses centiseconds (10ms units)
            '-resize', target_size,
            '-background', 'white',
            '-gravity', 'center',
            '-extent', target_size,
        ]
        
        # Add all frames
        cmd.extend(frames)
        
        # Add output path
        cmd.append(output_path)
        
        # Execute the convert command
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            if os.path.exists(output_path):
                os.unlink(output_path)
            raise Exception(f"ImageMagick error: {result.stderr}")
        
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            raise Exception("Failed to create GIF file")
        
        return output_path
    
    except subprocess.TimeoutExpired:
        if os.path.exists(output_path):
            os.unlink(output_path)
        raise Exception("GIF creation timed out")
    except Exception as e:
        raise Exception(f"Error creating GIF: {str(e)}")


@app.route('/create-gif', methods=['POST'])
def create_gif():
    """Create a GIF from uploaded images"""
    try:
        # Validate required fields
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        if 'targetSize' not in request.form:
            return jsonify({'error': 'targetSize is required'}), 400
        
        # Get and validate target size
        target_size = request.form.get('targetSize', '').strip()
        validated_size = validate_size_format(target_size)
        if not validated_size:
            return jsonify({'error': 'Invalid targetSize format. Use WIDTHxHEIGHT (e.g., 500x500)'}), 400
        
        # Get delay (default 10ms)
        try:
            delay = int(request.form.get('delay', 10))
            if delay < 0:
                return jsonify({'error': 'delay must be non-negative'}), 400
        except ValueError:
            return jsonify({'error': 'delay must be an integer'}), 400
        
        # Get append_reverted flag (default False)
        append_reverted = request.form.get('appendReverted', 'false').lower() in ('true', '1', 'yes')
        
        # Get and validate images
        image_files = request.files.getlist('images')
        if not image_files or len(image_files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Save uploaded images to temporary directory
        temp_dir = tempfile.mkdtemp()
        image_paths = []
        
        try:
            for idx, file in enumerate(image_files):
                if file.filename == '':
                    continue
                
                # Save the file
                temp_path = os.path.join(temp_dir, f'image_{idx}')
                file.save(temp_path)
                image_paths.append(temp_path)
            
            if not image_paths:
                return jsonify({'error': 'No valid images provided'}), 400
            
            # Create the GIF
            gif_path = create_gif_from_images(image_paths, validated_size, delay, append_reverted)
            
            # Send the GIF file
            response = send_file(
                gif_path,
                mimetype='image/gif',
                as_attachment=True,
                download_name='output.gif'
            )
            
            # Clean up temporary files after sending
            @response.call_on_close
            def cleanup():
                try:
                    if os.path.exists(gif_path):
                        os.unlink(gif_path)
                    for img_path in image_paths:
                        if os.path.exists(img_path):
                            os.unlink(img_path)
                    if os.path.exists(temp_dir):
                        os.rmdir(temp_dir)
                except Exception:
                    pass
            
            return response
        
        except Exception as e:
            # Clean up on error
            for img_path in image_paths:
                if os.path.exists(img_path):
                    os.unlink(img_path)
            if os.path.exists(temp_dir):
                try:
                    os.rmdir(temp_dir)
                except Exception:
                    pass
            
            return jsonify({'error': str(e)}), 500
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)