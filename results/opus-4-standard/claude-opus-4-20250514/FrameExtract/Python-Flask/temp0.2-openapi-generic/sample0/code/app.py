import os
import subprocess
import tempfile
import json
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
from werkzeug.exceptions import BadRequest
import shutil

app = Flask(__name__)

# Configure maximum file size (100MB)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

# Allowed video extensions
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Check if the post request has the file part
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    video_file = request.files['video']
    
    # Check if file is selected
    if video_file.filename == '':
        return jsonify({'error': 'No video file selected'}), 400
    
    # Get frame number
    try:
        frame_number = int(request.form.get('frameNumber', 0))
        if frame_number < 0:
            return jsonify({'error': 'Frame number must be non-negative'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid frame number'}), 400
    
    # Get video filename (optional, for validation)
    video_filename = request.form.get('videoFileName', video_file.filename)
    
    # Validate file extension
    if not allowed_file(video_file.filename):
        return jsonify({'error': 'Invalid video file format'}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Save uploaded video to temporary file
        video_filename_secure = secure_filename(video_file.filename)
        video_path = os.path.join(temp_dir, video_filename_secure)
        video_file.save(video_path)
        
        # Output image path
        output_path = os.path.join(temp_dir, 'frame.png')
        
        # Use ffmpeg to extract the frame
        # -ss seeks to approximate timestamp, -i input file, -vf select exact frame, -vframes 1 to extract single frame
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            '-y',  # Overwrite output file
            output_path
        ]
        
        # Run ffmpeg command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Check if frame was extracted successfully
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            # Try to get video info to provide better error message
            probe_cmd = [
                'ffmpeg',
                '-i', video_path,
                '-hide_banner'
            ]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
            
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
        
        # Send the extracted frame
        return send_file(output_path, mimetype='image/png', as_attachment=False)
        
    except Exception as e:
        return jsonify({'error': f'An error occurred while processing the video: {str(e)}'}), 500
    
    finally:
        # Clean up temporary directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Video file too large. Maximum size is 100MB.'}), 413

@app.errorhandler(BadRequest)
def handle_bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)