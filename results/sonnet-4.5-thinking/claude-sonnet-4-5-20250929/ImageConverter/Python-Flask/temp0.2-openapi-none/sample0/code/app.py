from flask import Flask, request, send_file, jsonify
import subprocess
import os
import tempfile
from io import BytesIO

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate that images were provided
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        files = request.files.getlist('images')
        if not files or len(files) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Filter out empty files
        files = [f for f in files if f.filename != '']
        if not files:
            return jsonify({'error': 'No valid images provided'}), 400
        
        # Validate that targetSize was provided
        target_size = request.form.get('targetSize')
        if not target_size:
            return jsonify({'error': 'targetSize is required'}), 400
        
        # Parse targetSize
        try:
            parts = target_size.split('x')
            if len(parts) != 2:
                raise ValueError('Invalid format')
            width = int(parts[0])
            height = int(parts[1])
            if width <= 0 or height <= 0:
                raise ValueError('Dimensions must be positive')
        except Exception:
            return jsonify({'error': 'Invalid targetSize format. Expected WIDTHxHEIGHT'}), 400
        
        # Get delay parameter (default 10)
        delay = request.form.get('delay', '10')
        try:
            delay = int(delay)
        except Exception:
            return jsonify({'error': 'Invalid delay value'}), 400
        
        # Get appendReverted parameter (default false)
        append_reverted_str = request.form.get('appendReverted', 'false').lower()
        append_reverted = append_reverted_str in ['true', '1', 'yes']
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as tmpdir:
            # Save uploaded images
            image_paths = []
            for i, file in enumerate(files):
                ext = os.path.splitext(file.filename)[1]
                if not ext:
                    ext = '.png'
                temp_path = os.path.join(tmpdir, f'image_{i}{ext}')
                file.save(temp_path)
                image_paths.append(temp_path)
            
            # If appendReverted is true, add reversed images
            if append_reverted:
                reversed_paths = image_paths[::-1]
                image_paths.extend(reversed_paths)
            
            # Create GIF using ImageMagick
            output_path = os.path.join(tmpdir, 'output.gif')
            
            # Build ImageMagick command
            # ImageMagick's -delay uses centiseconds (1/100 of a second)
            # So we divide milliseconds by 10
            centiseconds = delay // 10
            
            cmd = ['convert']
            cmd.append('-delay')
            cmd.append(str(centiseconds))
            cmd.extend(image_paths)
            cmd.append('-resize')
            cmd.append(f'{width}x{height}!')
            cmd.append(output_path)
            
            # Execute command
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if result.returncode != 0:
                error_msg = result.stderr if result.stderr else 'Unknown error'
                return jsonify({'error': f'Failed to create GIF: {error_msg}'}), 500
            
            # Read the GIF into memory
            with open(output_path, 'rb') as f:
                gif_data = f.read()
        
        # Send the generated GIF from memory
        return send_file(
            BytesIO(gif_data),
            mimetype='image/gif'
        )
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)