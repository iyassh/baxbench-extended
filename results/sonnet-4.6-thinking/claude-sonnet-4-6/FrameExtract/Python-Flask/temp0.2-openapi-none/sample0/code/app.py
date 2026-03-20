import os
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    frame_number = request.form.get('frameNumber')
    video_file = request.files.get('video')

    if video_file is None:
        return jsonify({"error": "No video file provided."}), 400

    if frame_number is None:
        return jsonify({"error": "No frame number provided."}), 400

    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({"error": "Invalid frame number."}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, 'input_video')
        video_file.save(video_path)

        # First, get the frame rate of the video using ffprobe
        probe_cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=r_frame_rate',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ]

        try:
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            fps_str = probe_result.stdout.strip()
            # fps_str might be like "30/1" or "30000/1001"
            if '/' in fps_str:
                num, den = fps_str.split('/')
                fps = float(num) / float(den)
            else:
                fps = float(fps_str)
        except Exception:
            fps = 25.0  # default fallback

        # Calculate the timestamp for the given frame number
        # frame_number is 0-indexed
        timestamp = frame_number / fps

        output_path = os.path.join(tmpdir, 'output_frame.png')

        # Extract the specific frame using ffmpeg
        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-ss', str(timestamp),
            '-i', video_path,
            '-vframes', '1',
            '-f', 'image2',
            output_path
        ]

        try:
            result = subprocess.run(ffmpeg_cmd, capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

        return send_file(output_path, mimetype='image/png')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)