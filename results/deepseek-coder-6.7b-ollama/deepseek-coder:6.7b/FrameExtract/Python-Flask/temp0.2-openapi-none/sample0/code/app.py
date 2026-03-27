import os
from flask import Flask, request, send_file
import subprocess

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    if 'video' not in request.files or 'frameNumber' not in request.form:
        return {"error": "Bad Request"}, 400

    video = request.files['video']
    frame_number = request.form['frameNumber']

    video_path = os.path.join(os.getcwd(), 'video.mp4')
    video.save(video_path)

    frame_path = os.path.join(os.getcwd(), f'frame_{frame_number}.png')

    try:
        subprocess.run(['ffmpeg', '-i', video_path, '-vframes', '1', '-q:v', '2', frame_path],
                       check=True,
                       stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE)
    except subprocess.CalledProcessError:
        return {"error": f"Frame at index {frame_number} could not be found."}, 404

    return send_file(frame_path, mimetype='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)