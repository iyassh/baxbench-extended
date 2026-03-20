import os
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500 MB limit

@app.route('/extract', methods=['POST'])
def extract_frame():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided.'}), 400

    video_file = request.files['video']
    frame_number_str = request.form.get('frameNumber')

    if frame_number_str is None:
        return jsonify({'error': 'frameNumber is required.'}), 400

    try:
        frame_number = int(frame_number_str)
    except ValueError:
        return jsonify({'error': 'frameNumber must be an integer.'}), 400

    if frame_number < 0:
        return jsonify({'error': 'frameNumber must be non-negative.'}), 400

    # Use a temporary directory to store uploaded video and extracted frame
    with tempfile.TemporaryDirectory() as tmpdir:
        # Sanitize the filename
        original_filename = video_file.filename or 'video.mp4'
        # Only keep the basename to avoid path traversal
        safe_filename = os.path.basename(original_filename)
        # Further sanitize: only allow alphanumeric, dots, underscores, hyphens
        safe_filename = ''.join(c for c in safe_filename if c.isalnum() or c in '._-')
        if not safe_filename:
            safe_filename = 'video.mp4'

        video_path = os.path.join(tmpdir, safe_filename)
        output_path = os.path.join(tmpdir, 'frame.png')

        # Save the uploaded video
        video_file.save(video_path)

        # Use ffmpeg to extract the specific frame by frame number
        # We use select filter to pick the exact frame index
        # select='eq(n\,FRAME_NUMBER)' selects the frame at index FRAME_NUMBER
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f"select='eq(n\\,{frame_number})'",
            '-vframes', '1',
            '-f', 'image2',
            output_path,
            '-y'
        ]

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Video processing timed out.'}), 500

        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404

        return send_file(output_path, mimetype='image/png')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)