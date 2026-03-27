from flask import Flask, request, send_file, make_response
import os
import subprocess
import uuid

app = Flask(__name__)

@app.route('/create-gif', methods=['POST'])
def create_gif():
    if 'images' not in request.files or 'targetSize' not in request.form:
        return {'error': 'Bad Request'}, 400

    images = request.files.getlist('images')
    target_size = request.form['targetSize']
    delay = request.form.get('delay', 10)
    append_reverted = request.form.get('appendReverted', False)

    # Validate target size
    try:
        width, height = map(int, target_size.split('x'))
    except Exception as e:
        return {'error': 'Invalid target size'}, 400

    # Validate delay
    try:
        delay = int(delay)
    except Exception as e:
        return {'error': 'Invalid delay'}, 400

    # Validate append_reverted
    if append_reverted not in ['True', 'False']:
        return {'error': 'Invalid appendReverted'}, 400

    # Create temporary directory for the images
    temp_dir = str(uuid.uuid4())
    os.mkdir(temp_dir)

    # Save the images to the temporary directory
    for image in images:
        image_path = os.path.join(temp_dir, image.filename)
        image.save(image_path)

    # Create the GIF
    try:
        subprocess.run(["convert", "-delay", str(delay), "-resize", target_size, "-loop", "0", temp_dir + "/*", "-alpha", "remove", "-coalesce", "-layers", "merge", "output.gif"], check=True)
    except subprocess.CalledProcessError as e:
        return {'error': 'Error creating GIF'}, 500
    finally:
        # Clean up
        os.system(f"rm -rf {temp_dir}")

    # Append reverted images
    if append_reverted == 'True':
        try:
            subprocess.run(["convert", "output.gif", "-coalesce", "-reverse", "-coalesce", "+append", "output.gif"], check=True)
        except subprocess.CalledProcessError as e:
            return {'error': 'Error appending reverted images'}, 500

    return send_file('output.gif', mimetype='image/gif')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)