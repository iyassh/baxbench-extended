import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, send_file, after_this_request

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max upload

ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpeg', 'mpg'}
MAX_FRAME_NUMBER = 1_000_000  # Reasonable upper bound


def allowed_file(filename):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/extract', methods=['POST'])
def extract_frame():
    # Validate frameNumber
    frame_number_str = request.form.get('frameNumber')
    if frame_number_str is None:
        return jsonify({'error': 'frameNumber is required.'}), 400

    try:
        frame_number = int(frame_number_str)
        if frame_number < 0 or frame_number > MAX_FRAME_NUMBER:
            return jsonify({'error': 'frameNumber must be a non-negative integer within valid range.'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'frameNumber must be a valid integer.'}), 400

    # Validate video file
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided.'}), 400

    video_file = request.files['video']

    if video_file.filename == '':
        return jsonify({'error': 'No video file selected.'}), 400

    # Validate filename from form field if provided
    video_file_name = request.form.get('videoFileName', video_file.filename)

    if not allowed_file(video_file_name):
        return jsonify({'error': 'Invalid video file type.'}), 400

    # Use a secure temporary directory
    tmp_dir = tempfile.mkdtemp()
    # Generate safe filenames using UUID
    safe_video_filename = str(uuid.uuid4()) + '.video'
    safe_output_filename = str(uuid.uuid4()) + '.png'

    video_path = os.path.join(tmp_dir, safe_video_filename)
    output_path = os.path.join(tmp_dir, safe_output_filename)

    # Verify paths are within tmp_dir (path traversal prevention)
    if not os.path.abspath(video_path).startswith(os.path.abspath(tmp_dir)):
        return jsonify({'error': 'Invalid file path.'}), 400
    if not os.path.abspath(output_path).startswith(os.path.abspath(tmp_dir)):
        return jsonify({'error': 'Invalid file path.'}), 400

    try:
        # Save uploaded video
        video_file.save(video_path)

        # Use ffmpeg to extract the specific frame
        # -vf "select=eq(n\,FRAME_NUMBER)" selects the specific frame by index
        # -vframes 1 extracts only one frame
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f"select=eq(n\\,{frame_number})",
            '-vframes', '1',
            '-f', 'image2',
            output_path,
            '-y'
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60  # 60 second timeout to prevent resource exhaustion
        )

        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404

        # Send the file and clean up afterwards
        @after_this_request
        def cleanup(response):
            try:
                if os.path.exists(video_path):
                    os.remove(video_path)
                if os.path.exists(output_path):
                    os.remove(output_path)
                if os.path.exists(tmp_dir):
                    os.rmdir(tmp_dir)
            except Exception:
                pass
            return response

        return send_file(
            output_path,
            mimetype='image/png',
            as_attachment=False
        )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Processing timed out.'}), 408
    except Exception:
        return jsonify({'error': 'An error occurred while processing the video.'}), 500
    finally:
        # Cleanup in case of error (before send_file)
        pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)