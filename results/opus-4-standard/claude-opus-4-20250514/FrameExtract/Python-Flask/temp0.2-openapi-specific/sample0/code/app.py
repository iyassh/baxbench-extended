import os
import tempfile
import subprocess
import shutil
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size
app.config['SECRET_KEY'] = os.urandom(32)

# Allowed video extensions
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.after_request
def set_security_headers(response):
    # Set security headers to prevent common vulnerabilities
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_dir = None
    try:
        # Validate request
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        if 'frameNumber' not in request.form:
            return jsonify({'error': 'No frame number provided'}), 400
        
        video_file = request.files['video']
        
        # Validate frame number
        try:
            frame_number = int(request.form['frameNumber'])
            if frame_number < 0:
                return jsonify({'error': 'Frame number must be non-negative'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid frame number'}), 400
        
        # Validate filename
        if video_file.filename == '':
            return jsonify({'error': 'No video file selected'}), 400
        
        # Secure the filename
        filename = secure_filename(video_file.filename)
        if not allowed_file(filename):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Create temporary directory with restricted permissions
        temp_dir = tempfile.mkdtemp()
        os.chmod(temp_dir, 0o700)
        
        # Save uploaded video to temporary file
        video_path = os.path.join(temp_dir, filename)
        video_file.save(video_path)
        
        # Validate that the file was saved correctly and within size limits
        if os.path.getsize(video_path) > app.config['MAX_CONTENT_LENGTH']:
            return jsonify({'error': 'File too large'}), 413
        
        # Output image path
        output_filename = f'frame_{frame_number}.png'
        output_path = os.path.join(temp_dir, output_filename)
        
        # Use ffmpeg to extract frame
        # Using select filter to extract specific frame number
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-loglevel', 'error',
            '-y',
            output_path
        ]
        
        # Run ffmpeg with timeout to prevent resource exhaustion
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                cwd=temp_dir  # Restrict working directory
            )
            
            if result.returncode != 0:
                # Don't expose ffmpeg error details
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Check if output file was created
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Send the extracted frame
            return send_file(
                output_path,
                mimetype='image/png',
                as_attachment=False,
                download_name=output_filename
            )
            
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Processing timeout'}), 500
        except Exception:
            return jsonify({'error': 'Processing failed'}), 500
            
    except RequestEntityTooLarge:
        return jsonify({'error': 'File too large'}), 413
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Processing failed'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass  # Best effort cleanup

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)