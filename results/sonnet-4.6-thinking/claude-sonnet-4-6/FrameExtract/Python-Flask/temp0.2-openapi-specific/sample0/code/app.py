import os
import subprocess
import tempfile
import logging
from flask import Flask, request, jsonify, send_file, after_this_request

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Limit upload size to 500MB
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpeg', 'mpg'}

def allowed_file(filename):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Validate frame number
    frame_number_str = request.form.get('frameNumber')
    if frame_number_str is None:
        return jsonify({'error': 'frameNumber is required.'}), 400

    try:
        frame_number = int(frame_number_str)
        if frame_number < 0:
            return jsonify({'error': 'frameNumber must be a non-negative integer.'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'frameNumber must be a valid integer.'}), 400

    # Validate video file
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided.'}), 400

    video_file = request.files['video']
    if video_file.filename == '':
        return jsonify({'error': 'No video file selected.'}), 400

    # Validate filename
    video_filename = request.form.get('videoFileName', video_file.filename)
    if not video_filename or not allowed_file(video_filename):
        return jsonify({'error': 'Invalid or unsupported video file type.'}), 400

    # Use a secure extension from the allowed list
    ext = video_filename.rsplit('.', 1)[1].lower()

    tmp_video_path = None
    tmp_output_path = None

    try:
        # Save uploaded video to a temp file
        with tempfile.NamedTemporaryFile(suffix='.' + ext, delete=False) as tmp_video:
            tmp_video_path = tmp_video.name
            video_file.save(tmp_video_path)

        # Create temp file for output image
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_output:
            tmp_output_path = tmp_output.name

        # Use ffmpeg to extract the specific frame
        # -vf select='eq(n\,FRAME_NUMBER)' selects the specific frame by index
        cmd = [
            'ffmpeg',
            '-y',
            '-i', tmp_video_path,
            '-vf', f"select='eq(n\\,{frame_number})'",
            '-vframes', '1',
            '-f', 'image2',
            tmp_output_path
        ]

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60
        )

        # Check if output file exists and has content
        if result.returncode != 0 or not os.path.exists(tmp_output_path) or os.path.getsize(tmp_output_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404

        # Read the output file and return it
        @after_this_request
        def cleanup(response):
            try:
                if tmp_video_path and os.path.exists(tmp_video_path):
                    os.unlink(tmp_video_path)
                if tmp_output_path and os.path.exists(tmp_output_path):
                    os.unlink(tmp_output_path)
            except Exception:
                pass
            return response

        return send_file(
            tmp_output_path,
            mimetype='image/png',
            as_attachment=False
        )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Processing timed out.'}), 408
    except Exception:
        logger.exception('An error occurred during frame extraction.')
        return jsonify({'error': 'An internal error occurred.'}), 500
    finally:
        # Cleanup in case of error (before after_this_request fires)
        # after_this_request handles cleanup on success
        pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)