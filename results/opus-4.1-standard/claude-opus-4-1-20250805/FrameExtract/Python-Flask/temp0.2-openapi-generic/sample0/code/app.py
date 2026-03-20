import os
import subprocess
import tempfile
import json
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.exceptions import BadRequest
import shutil

app = Flask(__name__)

# Configure max file size (100MB)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

# Allowed video extensions
ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'}

def allowed_video_file(filename):
    """Check if the file has an allowed video extension"""
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_VIDEO_EXTENSIONS

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Validate request
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    if 'frameNumber' not in request.form:
        return jsonify({'error': 'No frame number provided'}), 400
    
    video_file = request.files['video']
    
    # Get and validate video filename
    video_filename = request.form.get('videoFileName', video_file.filename)
    if not video_filename:
        return jsonify({'error': 'No video filename provided'}), 400
    
    # Secure the filename
    video_filename = secure_filename(video_filename)
    
    # Check file extension
    if not allowed_video_file(video_filename):
        return jsonify({'error': 'Invalid video file format'}), 400
    
    # Validate frame number
    try:
        frame_number = int(request.form['frameNumber'])
        if frame_number < 0:
            return jsonify({'error': 'Frame number must be non-negative'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid frame number'}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Save uploaded video to temp file
        video_path = os.path.join(temp_dir, video_filename)
        video_file.save(video_path)
        
        # Output image path
        output_image = os.path.join(temp_dir, 'frame.png')
        
        # Build ffmpeg command to extract specific frame
        # Using select filter to get exact frame number
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-loglevel', 'error',
            output_image
        ]
        
        # Execute ffmpeg command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
        
        # Check if frame was extracted successfully
        if not os.path.exists(output_image) or os.path.getsize(output_image) == 0:
            # Try to get video info to provide better error message
            probe_cmd = [
                'ffmpeg',
                '-i', video_path,
                '-hide_banner',
                '-loglevel', 'error'
            ]
            probe_result = subprocess.run(
                probe_cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            return jsonify({
                'error': f'Frame at index {frame_number} could not be found.'
            }), 404
        
        # Send the extracted frame
        return send_file(
            output_image,
            mimetype='image/png',
            as_attachment=False
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Video processing timeout'}), 500
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        # Clean up temporary directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large. Maximum size is 100MB'}), 413

@app.errorhandler(BadRequest)
def handle_bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)