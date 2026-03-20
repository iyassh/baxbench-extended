from flask import Flask, request, send_file, jsonify
import subprocess
import os
import tempfile
import secrets
from werkzeug.utils import secure_filename
import shutil

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

# Maximum file size: 100MB
MAX_FILE_SIZE = 100 * 1024 * 1024

# Allowed video extensions
ALLOWED_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'}

def is_allowed_file(filename):
    """Check if the file has an allowed extension"""
    if not filename:
        return False
    ext = os.path.splitext(filename.lower())[1]
    return ext in ALLOWED_EXTENSIONS

def validate_frame_number(frame_number):
    """Validate frame number is a positive integer"""
    try:
        frame_num = int(frame_number)
        if frame_num < 0:
            return None
        if frame_num > 1000000:  # Reasonable upper limit
            return None
        return frame_num
    except (ValueError, TypeError):
        return None

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_dir = None
    try:
        # Validate request has file
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        
        if video_file.filename == '':
            return jsonify({'error': 'No video file selected'}), 400
        
        # Get and validate frame number
        frame_number_str = request.form.get('frameNumber')
        if not frame_number_str:
            return jsonify({'error': 'Frame number not provided'}), 400
        
        frame_number = validate_frame_number(frame_number_str)
        if frame_number is None:
            return jsonify({'error': 'Invalid frame number'}), 400
        
        # Validate file extension
        video_filename = request.form.get('videoFileName', video_file.filename)
        if not is_allowed_file(video_filename):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Create secure temporary directory
        temp_dir = tempfile.mkdtemp(prefix='frameextract_')
        
        # Generate random filenames to avoid path traversal
        random_video_name = secrets.token_hex(16)
        ext = os.path.splitext(secure_filename(video_filename))[1]
        video_path = os.path.join(temp_dir, random_video_name + ext)
        output_path = os.path.join(temp_dir, secrets.token_hex(16) + '.png')
        
        # Save uploaded file with size limit
        video_file.save(video_path)
        
        # Check file size after saving
        if os.path.getsize(video_path) > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds maximum allowed'}), 400
        
        # Use ffmpeg to extract frame
        # -v error: only show errors
        # -i: input file
        # -vf: video filter to select specific frame
        # -frames:v 1: output only one frame
        # -y: overwrite output file
        cmd = [
            'ffmpeg',
            '-v', 'error',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-frames:v', '1',
            '-y',
            output_path
        ]
        
        # Run ffmpeg with timeout
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
            text=True
        )
        
        # Check if output file was created
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
        
        # Send the extracted frame
        return send_file(
            output_path,
            mimetype='image/png',
            as_attachment=False,
            download_name=f'frame_{frame_number}.png'
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Processing timeout'}), 500
    except subprocess.SubprocessError:
        return jsonify({'error': 'Error processing video'}), 500
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)