import os
import tempfile
import subprocess
import hashlib
import time
from flask import Flask, request, jsonify, send_file, make_response
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import shutil

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size
app.config['SECRET_KEY'] = os.urandom(32)

# Allowed video extensions
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg'}

def allowed_file(filename):
    """Check if file has allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error"""
    response = jsonify({'error': 'File size exceeds maximum allowed size'})
    response.status_code = 413
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic exception handler to avoid information disclosure"""
    app.logger.error(f"Unhandled exception: {str(e)}")
    response = jsonify({'error': 'An internal error occurred'})
    response.status_code = 500
    return response

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_dir = None
    try:
        # Validate request
        if 'video' not in request.files:
            response = jsonify({'error': 'No video file provided'})
            response.status_code = 400
            return response
        
        video_file = request.files['video']
        
        # Get and validate frame number
        try:
            frame_number = int(request.form.get('frameNumber', 0))
            if frame_number < 0:
                response = jsonify({'error': 'Frame number must be non-negative'})
                response.status_code = 400
                return response
            # Limit frame number to prevent excessive resource usage
            if frame_number > 1000000:
                response = jsonify({'error': 'Frame number exceeds maximum allowed value'})
                response.status_code = 400
                return response
        except (ValueError, TypeError):
            response = jsonify({'error': 'Invalid frame number'})
            response.status_code = 400
            return response
        
        # Get and validate filename
        video_filename = request.form.get('videoFileName', '')
        if not video_filename:
            video_filename = video_file.filename
        
        if not video_filename:
            response = jsonify({'error': 'No filename provided'})
            response.status_code = 400
            return response
        
        # Secure the filename to prevent path traversal
        video_filename = secure_filename(video_filename)
        
        if not allowed_file(video_filename):
            response = jsonify({'error': 'Invalid video file format'})
            response.status_code = 400
            return response
        
        # Create temporary directory with unique name
        timestamp = str(time.time()).replace('.', '')
        random_suffix = hashlib.md5(os.urandom(32)).hexdigest()[:8]
        temp_dir = tempfile.mkdtemp(prefix=f'frame_extract_{timestamp}_{random_suffix}_')
        
        try:
            # Save video file
            video_path = os.path.join(temp_dir, video_filename)
            video_file.save(video_path)
            
            # Validate that the saved file is within temp_dir (prevent path traversal)
            if not os.path.abspath(video_path).startswith(os.path.abspath(temp_dir)):
                response = jsonify({'error': 'Invalid file path'})
                response.status_code = 400
                return response
            
            # Output image path
            output_filename = f'frame_{frame_number}.png'
            output_path = os.path.join(temp_dir, output_filename)
            
            # Build ffmpeg command with proper escaping
            # Using select filter to extract specific frame
            cmd = [
                'ffmpeg',
                '-i', video_path,
                '-vf', f'select=eq(n\\,{frame_number})',
                '-vframes', '1',
                '-f', 'image2',
                '-y',  # Overwrite output
                output_path
            ]
            
            # Run ffmpeg with timeout to prevent resource exhaustion
            try:
                result = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30,  # 30 second timeout
                    check=False
                )
            except subprocess.TimeoutExpired:
                response = jsonify({'error': 'Video processing timeout'})
                response.status_code = 500
                return response
            
            # Check if frame was extracted successfully
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                response = jsonify({'error': f'Frame at index {frame_number} could not be found.'})
                response.status_code = 404
                return response
            
            # Send the extracted frame
            response = make_response(send_file(
                output_path,
                mimetype='image/png',
                as_attachment=False,
                download_name=output_filename
            ))
            
            # Clean up will happen in finally block
            return response
            
        except Exception as e:
            app.logger.error(f"Error processing video: {str(e)}")
            response = jsonify({'error': 'Failed to process video'})
            response.status_code = 500
            return response
            
    except RequestEntityTooLarge:
        response = jsonify({'error': 'File size exceeds maximum allowed size'})
        response.status_code = 413
        return response
    except Exception as e:
        app.logger.error(f"Unexpected error: {str(e)}")
        response = jsonify({'error': 'An internal error occurred'})
        response.status_code = 500
        return response
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                app.logger.error(f"Failed to clean up temp directory: {str(e)}")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)