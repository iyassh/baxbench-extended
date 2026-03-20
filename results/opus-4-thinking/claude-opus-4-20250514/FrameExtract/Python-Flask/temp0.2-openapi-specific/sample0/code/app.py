from flask import Flask, request, Response, jsonify
import subprocess
import tempfile
import os
import re
import shutil

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def validate_filename(filename):
    """Validate filename to prevent path traversal attacks"""
    if not filename:
        return False
    # Allow only alphanumeric, dots, hyphens, and underscores
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return False
    # Prevent directory traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    return True

def validate_frame_number(frame_number):
    """Validate frame number is a positive integer"""
    try:
        num = int(frame_number)
        return num >= 0
    except:
        return False

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_dir = None
    try:
        # Validate request
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 404
        
        if 'frameNumber' not in request.form:
            return jsonify({'error': 'No frame number provided'}), 404
        
        video_file = request.files['video']
        frame_number = request.form.get('frameNumber')
        video_filename = request.form.get('videoFileName', '')
        
        # Validate inputs
        if not validate_frame_number(frame_number):
            return jsonify({'error': 'Invalid frame number'}), 404
        
        frame_number = int(frame_number)
        
        if video_filename and not validate_filename(video_filename):
            return jsonify({'error': 'Invalid file name'}), 404
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save uploaded video
        video_path = os.path.join(temp_dir, 'input_video')
        video_file.save(video_path)
        
        # Output image path
        output_path = os.path.join(temp_dir, 'frame.png')
        
        # Extract frame using ffmpeg
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            output_path
        ]
        
        # Run ffmpeg with timeout to prevent hanging
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            text=True
        )
        
        # Check if frame was extracted successfully
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
        
        # Read the extracted frame
        with open(output_path, 'rb') as f:
            image_data = f.read()
        
        # Clean up temporary directory
        shutil.rmtree(temp_dir)
        
        # Return the image
        return Response(image_data, mimetype='image/png')
        
    except subprocess.TimeoutExpired:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        return jsonify({'error': 'Processing timeout'}), 404
    except Exception as e:
        # Clean up on error
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        # Don't expose internal error details
        return jsonify({'error': 'Failed to extract frame'}), 404

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)