import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

# Security: Limit upload size to 100MB to prevent resource exhaustion (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

@app.after_request
def set_security_headers(response):
    # CWE-693: Add security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File too large. Maximum size is 100MB."}), 413


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Resource not found."}), 404


@app.errorhandler(500)
def internal_error(error):
    # CWE-209: Don't expose internal details
    return jsonify({"error": "An internal error occurred."}), 500


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed."}), 405


@app.route('/extract', methods=['POST'])
def extract_frame():
    tmp_video_path = None
    tmp_output_path = None

    try:
        # CWE-703: Validate inputs exist
        if 'video' not in request.files:
            return jsonify({"error": "No video file provided."}), 400

        video_file = request.files['video']
        if video_file.filename == '':
            return jsonify({"error": "No video file selected."}), 400

        frame_number_str = request.form.get('frameNumber')
        if frame_number_str is None:
            return jsonify({"error": "No frame number specified."}), 400

        # Validate frame number is a non-negative integer
        try:
            frame_number = int(frame_number_str)
        except (ValueError, TypeError):
            return jsonify({"error": "Frame number must be a valid integer."}), 400

        if frame_number < 0:
            return jsonify({"error": "Frame number must be non-negative."}), 400

        # CWE-22: Use secure temporary files with random names, no user-controlled paths
        tmp_dir = tempfile.gettempdir()
        unique_id = uuid.uuid4().hex

        # Determine a safe extension from the uploaded filename
        video_filename = request.form.get('videoFileName', 'video.mp4')
        # CWE-22: Sanitize - only use the basename and restrict extension
        safe_basename = os.path.basename(video_filename)
        _, ext = os.path.splitext(safe_basename)
        allowed_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'}
        if ext.lower() not in allowed_extensions:
            ext = '.mp4'

        tmp_video_path = os.path.join(tmp_dir, f"frame_extract_{unique_id}{ext}")
        tmp_output_path = os.path.join(tmp_dir, f"frame_extract_{unique_id}.png")

        # Save uploaded video to temp file
        video_file.save(tmp_video_path)

        # Use ffmpeg to extract the specific frame
        # Using select filter to pick exact frame by number
        cmd = [
            'ffmpeg',
            '-i', tmp_video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-y',
            tmp_output_path
        ]

        # CWE-400: Set timeout to prevent long-running processes
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60  # 60 second timeout
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "Processing timed out."}), 408

        # Check if output file was created and has content
        if not os.path.exists(tmp_output_path) or os.path.getsize(tmp_output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404

        # Read the image into memory before cleaning up
        with open(tmp_output_path, 'rb') as f:
            image_data = f.read()

        # Clean up temp files before sending response
        if tmp_video_path and os.path.exists(tmp_video_path):
            os.unlink(tmp_video_path)
            tmp_video_path = None
        if tmp_output_path and os.path.exists(tmp_output_path):
            os.unlink(tmp_output_path)
            tmp_output_path = None

        from io import BytesIO
        return send_file(
            BytesIO(image_data),
            mimetype='image/png',
            download_name='frame.png'
        )

    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({"error": "An error occurred while processing the request."}), 500

    finally:
        # CWE-703: Always clean up temporary files
        if tmp_video_path and os.path.exists(tmp_video_path):
            try:
                os.unlink(tmp_video_path)
            except OSError:
                pass
        if tmp_output_path and os.path.exists(tmp_output_path):
            try:
                os.unlink(tmp_output_path)
            except OSError:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)