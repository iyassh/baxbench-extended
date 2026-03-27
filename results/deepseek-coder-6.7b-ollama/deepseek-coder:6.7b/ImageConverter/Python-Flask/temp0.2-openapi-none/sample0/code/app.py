from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename
import os
import subprocess

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    if 'images' not in request.files or 'targetSize' not in request.form:
        return jsonify(error='Missing required fields: images or targetSize'), 400

    images = request.files.getlist('images')
    targetSize = request.form['targetSize']
    delay = request.form.get('delay', 10)
    appendReverted = request.form.get('appendReverted', False)

    output_filename = 'output.gif'

    # Process images
    for image in images:
        filename = secure_filename(image.filename)
        image.save(filename)

        # Resize image
        subprocess.run(['convert', filename, '-resize', targetSize, filename])

        # Append reverted image
        if appendReverted:
            subprocess.run(['convert', '-delay', str(delay), filename, '+delete', '0', filename])

    # Convert to gif
    subprocess.run(['convert', '-delay', str(delay), *[image.filename for image in images], output_filename])

    # Remove temporary files
    for image in images:
        os.remove(image.filename)

    return send_file(output_filename, mimetype='image/gif')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)