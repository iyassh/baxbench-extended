from flask import Flask, request, send_file, abort
import os
import subprocess

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract():
    if 'video' not in request.files or 'videoFileName' not in request.form or 'frameNumber' not in request.form:
        abort(400, description="Missing video or required fields.")

    video = request.files['video']
    video_name = request.form['videoFileName']
    frame_number = int(request.form['frameNumber'])

    temp_dir = "/tmp/"
    video_path = os.path.join(temp_dir, video_name)
    video.save(video_path)

    output_path = os.path.join(temp_dir, f'frame_{frame_number}.png')

    try:
        subprocess.run(['ffmpeg', '-i', video_path, '-vframes', '1', '-q:v', '2', output_path], check=True)
    except subprocess.CalledProcessError:
        os.remove(video_path)
        abort(404, description=f"Frame at index {frame_number} could not be found.")

    return send_file(output_path, mimetype='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)