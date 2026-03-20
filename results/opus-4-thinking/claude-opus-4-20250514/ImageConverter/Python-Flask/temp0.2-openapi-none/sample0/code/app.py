import os
import tempfile
import subprocess
from flask import Flask, request, send_file, jsonify
import shutil

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    temp_dir = None
    try:
        # Check if images are provided
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get all uploaded images
        images = request.files.getlist('images')
        if len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get targetSize parameter
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize parameter is required'}), 400
        
        # Validate targetSize format
        try:
            width, height = target_size.split('x')
            int(width)
            int(height)
        except:
            return jsonify({'error': 'Invalid targetSize format. Expected format: widthxheight (e.g., 500x500)'}), 400
        
        # Get other parameters
        delay = request.form.get('delay', '10')
        try:
            delay = int(delay)
        except:
            return jsonify({'error': 'delay must be an integer'}), 400
        
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        
        # Save uploaded images
        image_paths = []
        for i, image in enumerate(images):
            if image.filename == '':
                continue
            # Save with numbered filename to maintain order
            filename = f'image_{i:04d}.png'
            filepath = os.path.join(temp_dir, filename)
            image.save(filepath)
            image_paths.append(filepath)
        
        if len(image_paths) == 0:
            return jsonify({'error': 'No valid images uploaded'}), 400
        
        # If appendReverted is true, add reversed images
        if append_reverted:
            reversed_paths = []
            for i, path in enumerate(reversed(image_paths)):
                # Copy the image with new name to maintain order
                new_filename = f'image_{len(image_paths) + i:04d}.png'
                new_path = os.path.join(temp_dir, new_filename)
                shutil.copy2(path, new_path)
                reversed_paths.append(new_path)
            image_paths.extend(reversed_paths)
        
        # Create output GIF path
        output_gif = os.path.join(temp_dir, 'output.gif')
        
        # Build ImageMagick convert command
        cmd = ['convert', '-delay', str(delay)]
        cmd.extend(image_paths)
        cmd.extend(['-loop', '0', '-resize', target_size, output_gif])
        
        # Execute convert command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({'error': f'Failed to create GIF: {result.stderr}'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_gif):
            return jsonify({'error': 'Failed to create GIF'}), 500
        
        # Return the GIF file
        return send_file(output_gif, mimetype='image/gif', as_attachment=True, download_name='output.gif')
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)