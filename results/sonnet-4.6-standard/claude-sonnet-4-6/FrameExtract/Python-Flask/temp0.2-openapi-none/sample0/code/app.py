import os
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    frame_number = request.form.get('frameNumber')
    video_file = request.files.get('video')
    video_file_name = request.form.get('videoFileName', 'video.mp4')

    if frame_number is None or video_file is None:
        return jsonify({"error": "Missing required parameters."}), 400

    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({"error": "frameNumber must be an integer."}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, video_file_name)
        video_file.save(video_path)

        output_image_path = os.path.join(tmpdir, 'frame.png')

        # Use ffmpeg to extract the specific frame by index
        # We use the select filter to pick the exact frame number
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            output_image_path,
            '-y'
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0 or not os.path.exists(output_image_path) or os.path.getsize(output_image_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

        return send_file(output_image_path, mimetype='image/png')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)