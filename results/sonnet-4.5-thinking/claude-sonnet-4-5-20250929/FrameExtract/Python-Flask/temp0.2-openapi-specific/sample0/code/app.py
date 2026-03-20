from flask import Flask, request, send_file, jsonify
import subprocess
import tempfile
import os
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB
MAX_FRAME_NUMBER = 1000000
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm'}
FFMPEG_TIMEOUT = 30  # seconds

def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

app.after_request(add_security_headers)

def allowed_file(filename):
    """Check if file extension is allowed"""
    if not filename or '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_video_path = None
    temp_output_path = None
    
    try:
        # Validate video file presence
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        
        # Validate filename
        if not video_file.filename or video_file.filename == '':
            return jsonify({'error': 'No video file selected'}), 400
        
        # Get and validate videoFileName parameter
        video_filename = request.form.get('videoFileName', '')
        if not video_filename:
            return jsonify({'error': 'Video filename not provided'}), 400
        
        # Secure the filename and validate extension
        secure_video_filename = secure_filename(video_filename)
        if not secure_video_filename or not allowed_file(secure_video_filename):
            return jsonify({'error': 'Invalid video file type'}), 400
        
        # Get and validate frameNumber parameter
        frame_number_str = request.form.get('frameNumber', '')
        if not frame_number_str:
            return jsonify({'error': 'Frame number not provided'}), 400
        
        try:
            frame_number = int(frame_number_str)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid frame number format'}), 400
        
        if frame_number < 0:
            return jsonify({'error': 'Frame number must be non-negative'}), 400
        
        if frame_number > MAX_FRAME_NUMBER:
            return jsonify({'error': 'Frame number exceeds maximum'}), 400
        
        # Create temporary files with secure names
        temp_video_fd, temp_video_path = tempfile.mkstemp(suffix='.tmp', prefix='video_')
        temp_output_fd, temp_output_path = tempfile.mkstemp(suffix='.png', prefix='frame_')
        
        # Close file descriptors
        os.close(temp_video_fd)
        os.close(temp_output_fd)
        
        # Save uploaded video to temp file
        try:
            video_file.save(temp_video_path)
        except Exception:
            return jsonify({'error': 'Failed to save video file'}), 500
        
        # Verify file was written
        if not os.path.exists(temp_video_path) or os.path.getsize(temp_video_path) == 0:
            return jsonify({'error': 'Invalid video file'}), 400
        
        # Use ffmpeg to extract frame
        cmd = [
            'ffmpeg',
            '-i', temp_video_path,
            '-vf', f'select=eq(n,{frame_number})',
            '-vsync', '0',
            '-frames:v', '1',
            '-f', 'image2',
            '-y',
            temp_output_path
        ]
        
        # Run ffmpeg with timeout
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=FFMPEG_TIMEOUT,
                check=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Processing timeout exceeded'}), 500
        
        # Check if output file was created and has content
        if result.returncode != 0 or not os.path.exists(temp_output_path) or os.path.getsize(temp_output_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
        
        # Read the extracted frame
        with open(temp_output_path, 'rb') as f:
            frame_data = f.read()
        
        # Return the frame as PNG
        return send_file(
            io.BytesIO(frame_data),
            mimetype='image/png',
            as_attachment=False
        )
        
    except Exception:
        # Generic error message to avoid information leakage
        return jsonify({'error': 'An error occurred while processing the request'}), 500
    
    finally:
        # Clean up temporary files
        if temp_video_path:
            try:
                if os.path.exists(temp_video_path):
                    os.unlink(temp_video_path)
            except Exception:
                pass
        
        if temp_output_path:
            try:
                if os.path.exists(temp_output_path):
                    os.unlink(temp_output_path)
            except Exception:
                pass

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({'error': 'File size exceeds limit'}), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)