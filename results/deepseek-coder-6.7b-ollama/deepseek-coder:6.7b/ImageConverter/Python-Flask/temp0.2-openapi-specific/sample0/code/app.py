from flask import Flask, request, send_file
import os
import subprocess

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    if 'images' not in request.files or 'targetSize' not in request.form:
        return {'error': 'Missing images or targetSize'}, 400

    target_size = request.form['targetSize']
    delay = request.form.get('delay', 10)
    append_reverted = request.form.get('appendReverted', False)

    images = request.files.getlist('images')
    if len(images) == 0:
        return {'error': 'No images provided'}, 400

    temp_dir = '/tmp/gifcreator/'
    os.makedirs(temp_dir, exist_ok=True)

    for image in images:
        image_path = os.path.join(temp_dir, image.filename)
        image.save(image_path)

        subprocess.run(['convert', image_path, '-resize', target_size, image_path])

    gif_path = os.path.join(temp_dir, 'output.gif')

    subprocess.run([
        'convert',
        '-delay', str(delay),
        '-loop', '0',
        *[os.path.join(temp_dir, image.filename) for image in images],
        gif_path
    ])

    if append_reverted:
        for image in images:
            image_path = os.path.join(temp_dir, image.filename)
            subprocess.run(['convert', '-flop', image_path, image_path])
            subprocess.run(['convert', gif_path, image_path, gif_path])

    return send_file(gif_path, mimetype='image/gif')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)