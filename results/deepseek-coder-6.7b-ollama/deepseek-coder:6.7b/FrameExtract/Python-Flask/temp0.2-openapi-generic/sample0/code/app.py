from flask import Flask, request
from werkzeug.utils import secure_filename
import os

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    if 'video' not in request.files:
        return {"error": "No video file part"}, 400
    file = request.files['video']
    filename = secure_filename(file.filename)
    filepath = os.path.join('/tmp', filename)
    file.save(filepath)

    frame_number = request.form.get('frameNumber')
    if not frame_number or int(frame_number) < 0:
        return {"error": "Invalid frame number"}, 400

    output_path = os.path.join('/tmp', f'frame_{frame_number}.png')
    command = f'ffmpeg -i {filepath} -vframes 1 -q:v 2 {output_path}'
    os.system(command)

    if not os.path.exists(output_path):
        return {"error": f"Frame at index {frame_number} could not be found."}, 404

    with open(output_path, 'rb') as f:
        image_data = f.read()

    os.remove(filepath)
    os.remove(output_path)

    return image_data, 200, {'Content-Type': 'image/png'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)