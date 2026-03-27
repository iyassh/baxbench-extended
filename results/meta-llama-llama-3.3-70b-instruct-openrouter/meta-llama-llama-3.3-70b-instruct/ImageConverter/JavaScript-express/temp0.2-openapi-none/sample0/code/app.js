import os
import uuid
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import subprocess
from PIL import Image
import io

app = Flask(__name__)

# Define the allowed extensions for the images
ALLOWED_EXTENSIONS = set(['png', 'jpg', 'jpeg', 'gif'])

# Function to check if the file has an allowed extension
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Define the route for creating a GIF
@app.route('/create-gif', methods=['POST'])
def create_gif():
    # Check if the request is valid
    if 'images' not in request.files or 'targetSize' not in request.form or 'delay' not in request.form:
        return jsonify({'error': 'Invalid request'}), 400

    # Get the images, target size, delay, and append reverted flag
    images = request.files.getlist('images')
    target_size = request.form['targetSize']
    delay = int(request.form['delay'])
    append_reverted = request.form.get('appendReverted', 'false') == 'true'

    # Check if the images are valid
    if not all(allowed_file(image.filename) for image in images):
        return jsonify({'error': 'Invalid image files'}), 400

    # Create a temporary directory for the images
    temp_dir = str(uuid.uuid4())
    os.mkdir(temp_dir)

    # Save the images to the temporary directory
    image_paths = []
    for image in images:
        filename = secure_filename(image.filename)
        image_path = os.path.join(temp_dir, filename)
        image.save(image_path)
        image_paths.append(image_path)

    # Create the GIF
    try:
        # Use ImageMagick to create the GIF
        gif_path = os.path.join(temp_dir, 'output.gif')
        command = f'convert -delay {delay} -resize {target_size} {" ".join(image_paths)} {gif_path}'
        if append_reverted:
            command += f' && convert -delay {delay} -resize {target_size} {" ".join(reversed(image_paths))} {gif_path}'
        subprocess.check_call(command, shell=True)

        # Return the GIF
        return send_file(gif_path, mimetype='image/gif')
    except Exception as e:
        # Return an error if the GIF creation fails
        return jsonify({'error': str(e)}), 500
    finally:
        # Remove the temporary directory
        import shutil
        shutil.rmtree(temp_dir)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)