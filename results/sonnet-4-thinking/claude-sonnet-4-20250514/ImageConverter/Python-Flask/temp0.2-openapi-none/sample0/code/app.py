from flask import Flask, request, jsonify, Response
import os
import tempfile
import subprocess
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if images are present
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        images = request.files.getlist('images')
        if not images or len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Get other parameters
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        # Validate target size format
        if 'x' not in target_size:
            return jsonify({'error': 'targetSize must be in format widthxheight'}), 400
        
        try:
            width, height = target_size.split('x')
            width = int(width)
            height = int(height)
            if width <= 0 or height <= 0:
                raise ValueError("Dimensions must be positive")
        except ValueError:
            return jsonify({'error': 'targetSize must contain valid positive integers'}), 400
        
        # Parse delay
        delay_str = request.form.get('delay', '10')
        try:
            delay = int(delay_str)
            if delay < 0:
                raise ValueError("Delay must be non-negative")
        except ValueError:
            return jsonify({'error': 'delay must be a non-negative integer'}), 400
        
        # Parse appendReverted
        append_reverted_str = request.form.get('appendReverted', 'false')
        append_reverted = append_reverted_str.lower() in ['true', '1', 'yes']
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        temp_files = []
        
        try:
            # Save uploaded images
            for i, image in enumerate(images):
                filename = secure_filename(image.filename) if image.filename else ''
                if not filename:
                    filename = f"image_{i}.jpg"
                else:
                    filename = f"image_{i}_{filename}"
                
                filepath = os.path.join(temp_dir, filename)
                image.save(filepath)
                temp_files.append(filepath)
            
            if not temp_files:
                return jsonify({'error': 'No valid images provided'}), 400
            
            # Prepare ImageMagick command
            output_gif = os.path.join(temp_dir, 'output.gif')
            
            # Convert milliseconds to centiseconds (ImageMagick unit)
            delay_centiseconds = max(1, delay // 10)
            
            # Build convert command
            cmd = ['convert']
            
            # Add delay
            cmd.extend(['-delay', str(delay_centiseconds)])
            
            # Add input files
            cmd.extend(temp_files)
            
            # Add reverted files if requested
            if append_reverted and len(temp_files) > 1:
                # Add reversed list of files (excluding last to avoid duplication)
                reversed_files = temp_files[-2::-1]
                cmd.extend(reversed_files)
            
            # Add resize and output
            cmd.extend(['-resize', target_size, output_gif])
            
            # Execute ImageMagick command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                return jsonify({'error': f'ImageMagick error: {result.stderr}'}), 500
            
            # Read the GIF file and return it
            with open(output_gif, 'rb') as f:
                gif_data = f.read()
            
            return Response(gif_data, mimetype='image/gif')
        
        finally:
            # Clean up temporary files
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)