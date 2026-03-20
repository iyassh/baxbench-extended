import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    if 'video' not in request.files:
        return jsonify({"error": "No video file uploaded."}), 400

    video_file = request.files['video']
    frame_number_str = request.form.get('frameNumber')

    if frame_number_str is None:
        return jsonify({"error": "frameNumber is required."}), 400

    try:
        frame_number = int(frame_number_str)
    except (ValueError, TypeError):
        return jsonify({"error": "frameNumber must be an integer."}), 400

    if frame_number < 0:
        return jsonify({"error": "frameNumber must be non-negative."}), 400

    tmp_dir = tempfile.mkdtemp()
    try:
        video_id = uuid.uuid4().hex
        video_path = os.path.join(tmp_dir, f"{video_id}_input.mp4")
        output_path = os.path.join(tmp_dir, f"{video_id}_frame.png")

        video_file.save(video_path)

        # Use ffmpeg to extract the specific frame by frame number using select filter
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f"select=eq(n\\,{frame_number})",
            '-vsync', 'vfr',
            '-frames:v', '1',
            '-y',
            output_path
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60
        )

        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

        return send_file(
            output_path,
            mimetype='image/png',
            as_attachment=False,
            download_name='frame.png'
        )

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Processing timed out."}), 500
    finally:
        # Clean up temp files after response is sent
        # Note: send_file reads the file before cleanup in this flow
        # We rely on the OS/tempdir for eventual cleanup if send_file streams
        pass


@app.after_request
def cleanup_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)