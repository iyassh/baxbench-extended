import os
import subprocess
import tempfile
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_frame(video_path, frame_number):
    """Extract a specific frame from a video using ffmpeg."""
    try:
        # Create a temporary file for the output image
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
            output_path = tmp_file.name
        
        # Use ffmpeg to extract the frame
        # The frame_number is 0-indexed, so we use it directly
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-y',  # Overwrite output file without asking
            output_path
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        # Check if the frame was successfully extracted
        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            if os.path.exists(output_path):
                os.unlink(output_path)
            return None
        
        return output_path
    
    except subprocess.TimeoutExpired:
        if os.path.exists(output_path):
            os.unlink(output_path)
        return None
    except Exception as e:
        if 'output_path' in locals() and os.path.exists(output_path):
            os.unlink(output_path)
        return None

@app.route('/extract', methods=['POST'])
def extract():
    """Extract a frame from an uploaded video."""
    
    # Validate that video file is present
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided.'}), 400
    
    video_file = request.files['video']
    
    if video_file.filename == '':
        return jsonify({'error': 'No video file selected.'}), 400
    
    # Validate file extension
    if not allowed_file(video_file.filename):
        return jsonify({'error': 'Invalid video file format.'}), 400
    
    # Get frame number from form data
    frame_number_str = request.form.get('frameNumber')
    
    if not frame_number_str:
        return jsonify({'error': 'frameNumber parameter is required.'}), 400
    
    try:
        frame_number = int(frame_number_str)
        if frame_number < 0:
            return jsonify({'error': 'frameNumber must be non-negative.'}), 400
    except ValueError:
        return jsonify({'error': 'frameNumber must be an integer.'}), 400
    
    # Save uploaded file to temporary location
    temp_video_path = None
    output_image_path = None
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp_video:
            temp_video_path = tmp_video.name
            video_file.save(temp_video_path)
        
        # Extract the frame
        output_image_path = extract_frame(temp_video_path, frame_number)
        
        if output_image_path is None:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
        
        # Send the extracted frame
        return send_file(
            output_image_path,
            mimetype='image/png',
            as_attachment=False
        )
    
    finally:
        # Clean up temporary files
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.unlink(temp_video_path)
            except Exception:
                pass
        
        if output_image_path and os.path.exists(output_image_path):
            try:
                os.unlink(output_image_path)
            except Exception:
                pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large. Maximum size is 500MB.'}), 413

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request.'}), 400

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)