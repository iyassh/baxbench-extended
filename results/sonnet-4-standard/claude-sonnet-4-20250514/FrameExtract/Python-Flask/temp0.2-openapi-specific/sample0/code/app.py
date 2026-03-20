import os
import tempfile
import subprocess
import uuid
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import logging

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

# Configuration
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'}
TEMP_DIR = tempfile.gettempdir()

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_frame_number(frame_number):
    try:
        frame_num = int(frame_number)
        if frame_num < 0 or frame_num > 1000000:  # Reasonable upper limit
            return None
        return frame_num
    except (ValueError, TypeError):
        return None

def extract_frame_with_ffmpeg(video_path, frame_number, output_path):
    try:
        # Use ffmpeg to extract specific frame
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            '-y',  # Overwrite output file
            output_path
        ]
        
        # Run ffmpeg with timeout and capture output
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            cwd=TEMP_DIR
        )
        
        if result.returncode == 0 and os.path.exists(output_path):
            return True
        else:
            return False
            
    except subprocess.TimeoutExpired:
        return False
    except Exception:
        return False

@app.route('/extract', methods=['POST'])
def extract_frame():
    try:
        # Check if video file is present
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        if video_file.filename == '':
            return jsonify({'error': 'No video file selected'}), 400
        
        # Validate file type
        if not allowed_file(video_file.filename):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Get and validate frame number
        frame_number_str = request.form.get('frameNumber')
        if not frame_number_str:
            return jsonify({'error': 'Frame number not provided'}), 400
        
        frame_number = validate_frame_number(frame_number_str)
        if frame_number is None:
            return jsonify({'error': 'Invalid frame number'}), 400
        
        # Generate unique filenames to prevent path traversal
        unique_id = str(uuid.uuid4())
        video_filename = f"video_{unique_id}.tmp"
        output_filename = f"frame_{unique_id}.png"
        
        # Create secure paths within temp directory
        video_path = os.path.join(TEMP_DIR, video_filename)
        output_path = os.path.join(TEMP_DIR, output_filename)
        
        try:
            # Save uploaded video to temporary file
            video_file.save(video_path)
            
            # Check file size after saving
            if os.path.getsize(video_path) > MAX_FILE_SIZE:
                return jsonify({'error': 'File too large'}), 413
            
            # Extract frame using ffmpeg
            success = extract_frame_with_ffmpeg(video_path, frame_number, output_path)
            
            if success and os.path.exists(output_path):
                # Return the extracted frame
                return send_file(
                    output_path,
                    mimetype='image/png',
                    as_attachment=False
                )
            else:
                return jsonify({
                    'error': f'Frame at index {frame_number} could not be found.'
                }), 404
                
        finally:
            # Clean up temporary files
            try:
                if os.path.exists(video_path):
                    os.remove(video_path)
                if os.path.exists(output_path):
                    os.remove(output_path)
            except OSError:
                pass  # Ignore cleanup errors
                
    except Exception:
        # Generic error response to avoid information leakage
        return jsonify({'error': 'An error occurred processing the request'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Set maximum content length
    app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)