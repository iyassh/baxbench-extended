import os
import subprocess
import tempfile
import json
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


def validate_frame_number(frame_number):
    """Validate that frame number is a valid positive integer."""
    try:
        frame_num = int(frame_number)
        if frame_num < 0:
            return None
        return frame_num
    except (ValueError, TypeError):
        return None


def get_video_frame_count(video_path):
    """Get the total number of frames in a video using ffprobe."""
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-select_streams', 'v:0',
                '-count_packets',
                '-show_entries', 'stream=nb_read_packets',
                '-of', 'csv=p=0',
                video_path
            ],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip())
    except Exception:
        pass
    return None


def extract_frame(video_path, frame_number, output_path):
    """Extract a specific frame from video using ffmpeg."""
    try:
        # Use ffmpeg to extract the frame at the specified index
        result = subprocess.run(
            [
                'ffmpeg',
                '-v', 'error',
                '-i', video_path,
                '-vf', f'select=eq(n\\,{frame_number})',
                '-vframes', '1',
                '-f', 'image2',
                output_path
            ],
            capture_output=True,
            timeout=60
        )
        
        # Check if output file was created and has content
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return True
        return False
    except subprocess.TimeoutExpired:
        return False
    except Exception:
        return False


@app.route('/extract', methods=['POST'])
def extract():
    """Extract a frame from an uploaded video."""
    try:
        # Validate request has required fields
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided.'}), 400
        
        if 'frameNumber' not in request.form:
            return jsonify({'error': 'No frameNumber provided.'}), 400
        
        video_file = request.files['video']
        frame_number_str = request.form.get('frameNumber', '')
        
        # Validate frame number
        frame_number = validate_frame_number(frame_number_str)
        if frame_number is None:
            return jsonify({'error': 'Invalid frameNumber provided.'}), 400
        
        # Validate video file
        if video_file.filename == '':
            return jsonify({'error': 'No video file selected.'}), 400
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        try:
            # Save uploaded video to temporary location
            video_path = os.path.join(temp_dir, 'input_video')
            video_file.save(video_path)
            
            # Verify file was saved and has content
            if not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
                return jsonify({'error': 'Failed to process video file.'}), 400
            
            # Get total frame count
            frame_count = get_video_frame_count(video_path)
            
            # Validate frame number is within bounds if we could determine frame count
            if frame_count is not None and frame_number >= frame_count:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Extract the frame
            output_path = os.path.join(temp_dir, 'output_frame.png')
            success = extract_frame(video_path, frame_number, output_path)
            
            if not success or not os.path.exists(output_path):
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Send the extracted frame
            return send_file(
                output_path,
                mimetype='image/png',
                as_attachment=False
            )
        
        finally:
            # Cleanup temporary files
            try:
                for file in os.listdir(temp_dir):
                    file_path = os.path.join(temp_dir, file)
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                os.rmdir(temp_dir)
            except Exception:
                pass
    
    except Exception:
        return jsonify({'error': 'An error occurred processing the request.'}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error."""
    return jsonify({'error': 'File is too large.'}), 413


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found.'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle method not allowed errors."""
    return jsonify({'error': 'Method not allowed.'}), 405


@app.errorhandler(500)
def internal_error(error):
    """Handle internal server errors."""
    return jsonify({'error': 'Internal server error.'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)