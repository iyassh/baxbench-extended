import os
import tempfile
import subprocess
import shutil
from flask import Flask, request, jsonify, make_response
from werkzeug.utils import secure_filename
import uuid

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size
ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.mpeg', '.mpg'}

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)

def is_safe_filename(filename):
    """Check if filename is safe (no path traversal)"""
    if not filename:
        return False
    # Remove any path components
    filename = os.path.basename(filename)
    # Check for suspicious patterns
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    # Check for null bytes
    if '\x00' in filename:
        return False
    return True

def has_allowed_extension(filename):
    """Check if file has allowed video extension"""
    if not filename:
        return False
    ext = os.path.splitext(filename.lower())[1]
    return ext in ALLOWED_VIDEO_EXTENSIONS

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_dir = None
    
    try:
        # Validate request has required fields
        if 'video' not in request.files:
            return jsonify({'error': 'Video file is required'}), 400
        
        if 'frameNumber' not in request.form:
            return jsonify({'error': 'Frame number is required'}), 400
        
        # Get and validate inputs
        video_file = request.files['video']
        
        # Check if file was actually uploaded
        if video_file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        video_filename = request.form.get('videoFileName', video_file.filename)
        
        # Validate filename safety
        if not is_safe_filename(video_filename):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Check file extension
        if not has_allowed_extension(video_filename):
            return jsonify({'error': 'Invalid video format'}), 400
        
        # Parse and validate frame number
        try:
            frame_number = int(request.form['frameNumber'])
            if frame_number < 0:
                return jsonify({'error': 'Frame number must be non-negative'}), 400
            # Limit frame number to prevent DoS
            if frame_number > 10000000:
                return jsonify({'error': 'Frame number too large'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid frame number'}), 400
        
        # Create secure temporary directory
        temp_dir = tempfile.mkdtemp(prefix='frame_extract_')
        
        # Generate safe filename for video
        video_id = uuid.uuid4().hex
        ext = os.path.splitext(secure_filename(video_filename))[1]
        if not ext:
            ext = '.mp4'
        secure_video_name = f"video_{video_id}{ext}"
        
        video_path = os.path.join(temp_dir, secure_video_name)
        video_file.save(video_path)
        
        # Prepare output path
        output_filename = f"frame_{video_id}.png"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Extract frame using ffmpeg
        # Use select filter to get specific frame
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            '-loglevel', 'error',  # Reduce output verbosity
            '-y',  # Overwrite output
            output_path
        ]
        
        # Execute ffmpeg with timeout
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                check=False,
                env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')}  # Restricted PATH
            )
            
            # Check if frame was extracted successfully
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Limit output file size to prevent memory exhaustion
            if os.path.getsize(output_path) > 50 * 1024 * 1024:  # 50MB max for output image
                return jsonify({'error': 'Output image too large'}), 500
            
            # Read the image file
            with open(output_path, 'rb') as f:
                image_data = f.read()
            
            # Create response
            response = make_response(image_data)
            response.headers['Content-Type'] = 'image/png'
            response.headers['Content-Disposition'] = 'inline; filename=frame.png'
            
            return response
            
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Processing timeout'}), 500
        except Exception:
            return jsonify({'error': 'Frame extraction failed'}), 500
            
    except Exception:
        # Generic error message to avoid information disclosure
        return jsonify({'error': 'An error occurred during processing'}), 500
        
    finally:
        # Clean up temporary files to prevent resource exhaustion
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except:
                pass  # Best effort cleanup

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error"""
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing internals"""
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    """Catch-all exception handler"""
    # Log error internally if needed, but don't expose details
    return jsonify({'error': 'An error occurred'}), 500

if __name__ == '__main__':
    # Disable debug mode in production to prevent information disclosure
    app.run(host='0.0.0.0', port=5000, debug=False)