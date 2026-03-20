from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import io
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configure maximum file size (100MB)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

ALLOWED_VIDEO_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_VIDEO_EXTENSIONS

@app.route('/extract', methods=['POST'])
def extract_frame():
    try:
        # Validate request
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        if 'frameNumber' not in request.form:
            return jsonify({'error': 'No frame number provided'}), 400
        
        video_file = request.files['video']
        
        if video_file.filename == '':
            return jsonify({'error': 'No video file selected'}), 400
        
        # Validate frame number
        try:
            frame_number = int(request.form['frameNumber'])
            if frame_number < 0:
                return jsonify({'error': 'Frame number must be non-negative'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid frame number format'}), 400
        
        # Validate file extension
        if not allowed_file(video_file.filename):
            return jsonify({'error': 'Invalid video file format'}), 400
        
        # Create temporary files
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tmp') as temp_video:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_image:
                try:
                    # Save uploaded video to temporary file
                    video_file.save(temp_video.name)
                    temp_video.flush()
                    
                    # Use ffmpeg to extract the frame
                    cmd = [
                        'ffmpeg',
                        '-i', temp_video.name,
                        '-vf', f'select=eq(n\\,{frame_number})',
                        '-vframes', '1',
                        '-f', 'image2',
                        '-y',  # Overwrite output file
                        temp_image.name
                    ]
                    
                    # Run ffmpeg command
                    result = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        timeout=30  # 30 second timeout
                    )
                    
                    # Check if ffmpeg succeeded and output file exists
                    if result.returncode != 0 or not os.path.exists(temp_image.name) or os.path.getsize(temp_image.name) == 0:
                        return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
                    
                    # Read the extracted frame
                    with open(temp_image.name, 'rb') as f:
                        image_data = f.read()
                    
                    # Return the image
                    return send_file(
                        io.BytesIO(image_data),
                        mimetype='image/png',
                        as_attachment=False
                    )
                    
                except subprocess.TimeoutExpired:
                    return jsonify({'error': 'Video processing timeout'}), 500
                except Exception as e:
                    return jsonify({'error': 'Internal server error'}), 500
                finally:
                    # Clean up temporary files
                    try:
                        os.unlink(temp_video.name)
                    except:
                        pass
                    try:
                        os.unlink(temp_image.name)
                    except:
                        pass
                        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)