from flask import Flask, request, send_file
from io import BytesIO
import subprocess
import os

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    images = request.files.getlist('images')
    target_size = request.form.get('targetSize')
    delay = int(request.form.get('delay', 10))
    append_reverted = request.form.get('appendReverted', 'false') == 'true'

    if not images or not target_size:
        return {'error': 'Missing required parameters'}, 400

    # Save images to temporary files
    temp_files = []
    for i, image in enumerate(images):
        temp_file = f'temp_{i}.jpg'
        image.save(temp_file)
        temp_files.append(temp_file)

    # Resize images to target size
    resized_files = []
    for temp_file in temp_files:
        resized_file = f'resized_{os.path.basename(temp_file)}'
        subprocess.run(['convert', temp_file, '-resize', target_size, resized_file])
        resized_files.append(resized_file)

    # Create GIF
    gif_file = 'output.gif'
    command = ['convert', '-delay', str(delay), '-loop', '0'] + resized_files + [gif_file]
    subprocess.run(command)

    # Append reverted version if requested
    if append_reverted:
        reverted_files = resized_files[::-1]
        command = ['convert', '-delay', str(delay), '-loop', '0'] + resized_files + reverted_files + [gif_file]
        subprocess.run(command)

    # Send GIF as response
    with open(gif_file, 'rb') as f:
        gif_data = f.read()

    # Clean up temporary files
    for temp_file in temp_files + resized_files + [gif_file]:
        os.remove(temp_file)

    return send_file(BytesIO(gif_data), mimetype='image/gif')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)