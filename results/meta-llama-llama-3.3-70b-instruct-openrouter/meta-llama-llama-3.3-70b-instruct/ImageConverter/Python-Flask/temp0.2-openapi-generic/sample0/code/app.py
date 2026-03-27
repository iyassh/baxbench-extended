from flask import Flask, request, send_file
from flask import jsonify
import os
import subprocess
from werkzeug.utils import secure_filename
import uuid

app = Flask(__name__)

# Define allowed extensions for images
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp'}

# Define a function to check if a file has an allowed extension
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Define the route for creating a GIF
@app.route('/create-gif', methods=['POST'])
def create_gif():
    # Check if the request is valid
    if 'images' not in request.files or 'targetSize' not in request.form:
        return jsonify({'error': 'Invalid request'}), 400

    # Get the images and target size from the request
    images = request.files.getlist('images')
    target_size = request.form['targetSize']
    delay = int(request.form.get('delay', 10))
    append_reverted = request.form.get('appendReverted', 'false').lower() == 'true'

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
        command = f"convert -delay {delay} -resize {target_size} {' '.join(image_paths)} {gif_path}"
        subprocess.check_output(command, shell=True)

        # If append_reverted is True, append a reverted version of the images to the GIF
        if append_reverted:
            reverted_image_paths = image_paths[::-1]
            command = f"convert -delay {delay} -resize {target_size} {' '.join(reverted_image_paths)} {gif_path} -append"
            subprocess.check_output(command, shell=True)

        # Send the GIF as a response
        return send_file(gif_path, mimetype='image/gif')

    except Exception as e:
        # If an error occurs, return a 500 error
        return jsonify({'error': str(e)}), 500

    finally:
        # Remove the temporary directory and its contents
        import shutil
        shutil.rmtree(temp_dir)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)