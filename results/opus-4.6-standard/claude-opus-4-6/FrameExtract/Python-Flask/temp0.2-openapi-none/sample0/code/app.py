import os
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    video = request.files.get('video')
    frame_number = request.form.get('frameNumber')
    video_file_name = request.form.get('videoFileName', 'video.mp4')

    if video is None or frame_number is None:
        return jsonify({"error": "Missing video or frameNumber parameter."}), 400

    try:
        frame_number = int(frame_number)
    except (ValueError, TypeError):
        return jsonify({"error": "frameNumber must be an integer."}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, video_file_name)
        video.save(video_path)

        output_path = os.path.join(tmpdir, 'frame.png')

        # Use ffmpeg to extract the specific frame
        # select='eq(n,FRAME)' selects the frame at index FRAME (0-based)
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f"select='eq(n\\,{frame_number})'",
            '-vsync', 'vfr',
            '-frames:v', '1',
            '-y',
            output_path
        ]

        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

        return send_file(output_path, mimetype='image/png')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)