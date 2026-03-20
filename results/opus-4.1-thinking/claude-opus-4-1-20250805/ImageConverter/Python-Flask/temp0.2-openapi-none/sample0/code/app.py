from flask import Flask, request, send_file, jsonify, render_template_string
import os
import tempfile
import subprocess
from werkzeug.utils import secure_filename
from io import BytesIO

app = Flask(__name__)

# HTML template for the web interface
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>GIF Creator</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
        }
        form {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input[type="file"],
        input[type="text"],
        input[type="number"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        input[type="checkbox"] {
            margin-right: 5px;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background-color: #45a049;
        }
        .description {
            color: #666;
            font-size: 14px;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <h1>GIF Creator</h1>
    <form action="/create-gif" method="POST" enctype="multipart/form-data">
        <div class="form-group">
            <label for="images">Select Images:</label>
            <input type="file" id="images" name="images" multiple accept="image/*" required>
            <div class="description">Select multiple images to create a GIF</div>
        </div>
        
        <div class="form-group">
            <label for="targetSize">Target Size:</label>
            <input type="text" id="targetSize" name="targetSize" placeholder="e.g., 500x500" required>
            <div class="description">Enter the target size in pixels (width x height)</div>
        </div>
        
        <div class="form-group">
            <label for="delay">Delay (milliseconds):</label>
            <input type="number" id="delay" name="delay" value="100" min="0">
            <div class="description">Delay between frames in milliseconds</div>
        </div>
        
        <div class="form-group">
            <label>
                <input type="checkbox" id="appendReverted" name="appendReverted" value="true">
                Append Reverted
            </label>
            <div class="description">Check to append a reversed version of the images to create a looping effect</div>
        </div>
        
        <button type="submit">Create GIF</button>
    </form>
</body>
</html>
'''

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    try:
        # Check if images are provided
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
        try:
            width, height = target_size.split('x')
            width = int(width)
            height = int(height)
            if width <= 0 or height <= 0:
                raise ValueError("Dimensions must be positive")
        except:
            return jsonify({'error': 'Invalid targetSize format. Expected format: widthxheight (e.g., 500x500) with positive dimensions'}), 400
        
        # Get delay with default value of 10
        try:
            delay = int(request.form.get('delay', '10'))
            if delay < 0:
                delay = 10  # Use default if negative
        except ValueError:
            return jsonify({'error': 'Invalid delay value. Must be an integer.'}), 400
        
        # Convert milliseconds to centiseconds for ImageMagick
        delay_centiseconds = max(1, delay // 10)  # Ensure at least 1 centisecond
        
        # Get appendReverted with default value of false
        append_reverted_str = request.form.get('appendReverted', 'false').lower()
        append_reverted = append_reverted_str in ['true', '1', 'yes']
        
        # Create temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded images
            image_paths = []
            for i, image in enumerate(images):
                if image.filename == '':
                    continue
                # Create a safe filename
                safe_filename = secure_filename(image.filename)
                if not safe_filename:
                    safe_filename = f"image_{i}.img"
                else:
                    safe_filename = f"image_{i}_{safe_filename}"
                    
                filepath = os.path.join(temp_dir, safe_filename)
                image.save(filepath)
                image_paths.append(filepath)
            
            if not image_paths:
                return jsonify({'error': 'No valid images provided'}), 400
            
            # If appendReverted is true, add reversed images
            if append_reverted:
                image_paths = image_paths + image_paths[::-1]
            
            # Create output GIF path
            output_path = os.path.join(temp_dir, 'output.gif')
            
            # Build ImageMagick convert command
            cmd = ['convert']
            cmd.extend(['-resize', target_size])
            cmd.extend(['-delay', str(delay_centiseconds)])
            cmd.extend(image_paths)
            cmd.append(output_path)
            
            # Execute the command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                return jsonify({'error': f'Failed to create GIF: {result.stderr}'}), 500
            
            # Check if the output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'Failed to create GIF'}), 500
            
            # Read the GIF file
            with open(output_path, 'rb') as f:
                gif_data = f.read()
            
            # Return the GIF
            return send_file(
                BytesIO(gif_data),
                mimetype='image/gif',
                as_attachment=True,
                download_name='output.gif'
            )
            
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)