from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Validate required fields
        if 'images' not in request.files:
            return jsonify({'error': 'No images provided'}), 400
        
        if 'targetSize' not in request.form:
            return jsonify({'error': 'Target size not provided'}), 400
        
        # Get parameters
        target_size = request.form.get('targetSize')
        delay = request.form.get('delay', '10')
        append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'
        
        # Validate target size format
        try:
            width, height = target_size.split('x')
            int(width)
            int(height)
        except:
            return jsonify({'error': 'Invalid target size format. Use format: widthxheight (e.g., 500x500)'}), 400
        
        # Validate delay
        try:
            delay_int = int(delay)
            if delay_int < 0:
                return jsonify({'error': 'Delay must be a positive integer'}), 400
        except:
            return jsonify({'error': 'Invalid delay value'}), 400
        
        # Get all uploaded images
        images = request.files.getlist('images')
        if len(images) == 0:
            return jsonify({'error': 'No images provided'}), 400
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        try:
            # Save uploaded images
            image_paths = []
            for i, image in enumerate(images):
                if image.filename == '':
                    continue
                filename = secure_filename(f"image_{i}_{image.filename}")
                filepath = os.path.join(temp_dir, filename)
                image.save(filepath)
                image_paths.append(filepath)
            
            if len(image_paths) == 0:
                return jsonify({'error': 'No valid images provided'}), 400
            
            # If append_reverted is true, add reversed order images
            if append_reverted:
                image_paths = image_paths + image_paths[::-1]
            
            # Output GIF path
            output_gif = os.path.join(temp_dir, 'output.gif')
            
            # Build ImageMagick convert command
            cmd = ['convert']
            
            # Add delay (convert uses centiseconds, so divide by 10)
            delay_cs = max(1, delay_int // 10)
            cmd.extend(['-delay', str(delay_cs)])
            
            # Add resize option
            cmd.extend(['-resize', target_size])
            
            # Add all image paths
            cmd.extend(image_paths)
            
            # Add output path
            cmd.append(output_gif)
            
            # Execute convert command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                return jsonify({'error': f'Failed to create GIF: {result.stderr}'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_gif):
                return jsonify({'error': 'Failed to create GIF file'}), 500
            
            # Send the GIF file
            return send_file(output_gif, mimetype='image/gif', as_attachment=True, download_name='output.gif')
            
        finally:
            # Clean up temporary directory
            try:
                shutil.rmtree(temp_dir)
            except:
                pass
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)