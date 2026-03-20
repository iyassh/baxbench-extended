import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Limit upload size to 100MB
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

ALLOWED_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'}

def is_valid_filename(filename):
    if not filename:
        return False
    basename = os.path.basename(filename)
    if basename != filename:
        return False
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    _, ext = os.path.splitext(filename)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        return False
    return True

@app.route('/extract', methods=['POST'])
def extract_frame():
    try:
        # Validate required fields
        if 'video' not in request.files:
            return jsonify({"error": "No video file provided."}), 400

        video_file = request.files['video']
        frame_number_str = request.form.get('frameNumber')
        video_file_name = request.form.get('videoFileName', '')

        if not frame_number_str:
            return jsonify({"error": "frameNumber is required."}), 400

        # Validate frame number
        try:
            frame_number = int(frame_number_str)
        except (ValueError, TypeError):
            return jsonify({"error": "frameNumber must be a valid integer."}), 400

        if frame_number < 0:
            return jsonify({"error": "frameNumber must be non-negative."}), 400

        # Validate filename if provided
        if video_file_name and not is_valid_filename(video_file_name):
            return jsonify({"error": "Invalid video file name."}), 400

        # Validate the uploaded file's filename
        if video_file.filename:
            _, ext = os.path.splitext(video_file.filename)
            if ext.lower() not in ALLOWED_EXTENSIONS:
                return jsonify({"error": "Unsupported video format."}), 400

        # Create temp directory for processing
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Save uploaded video to temp file with safe name
            safe_video_name = str(uuid.uuid4()) + '.mp4'
            video_path = os.path.join(tmp_dir, safe_video_name)
            video_file.save(video_path)

            # Verify the file was saved and is not empty
            if not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
                return jsonify({"error": "Failed to process video file."}), 400

            # Output image path
            output_name = str(uuid.uuid4()) + '.png'
            output_path = os.path.join(tmp_dir, output_name)

            # Use ffmpeg to extract the specific frame
            # select filter to pick exact frame by number
            try:
                result = subprocess.run(
                    [
                        'ffmpeg',
                        '-i', video_path,
                        '-vf', f"select=eq(n\\,{frame_number})",
                        '-vframes', '1',
                        '-y',
                        output_path
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30
                )
            except subprocess.TimeoutExpired:
                return jsonify({"error": "Processing timed out."}), 500

            # Check if output was created
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

            # Read the image into memory before temp dir is cleaned up
            with open(output_path, 'rb') as f:
                image_data = f.read()

        # Send the image from memory
        from io import BytesIO
        return send_file(
            BytesIO(image_data),
            mimetype='image/png',
            download_name='frame.png'
        )

    except Exception:
        return jsonify({"error": "An internal error occurred."}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)