<CODE>
from flask import Flask, request, jsonify, send_file
import subprocess
import os
import tempfile
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size

ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Validate request
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    video_file = request.files['video']
    
    if video_file.filename == '':
        return jsonify({'error': 'No video file selected'}), 400
    
    # Get frame number
    try:
        frame_number = int(request.form.get('frameNumber', 0))
        if frame_number < 0:
            return jsonify({'error': 'Frame number must be non-negative'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid frame number'}), 400
    
    # Validate file type
    if not allowed_file(video_file.filename):
        return jsonify({'error': 'Invalid file type'}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Save uploaded video to temporary file
        video_filename = secure_filename(video_file.filename)
        video_path = os.path.join(temp_dir, video_filename)
        video_file.save(video_path)
        
        # Output path for extracted frame
        output_path = os.path.join(temp_dir, 'frame.png')
        
        # Use ffmpeg to extract the specific frame
        # First, get total frame count to validate frame number
        probe_cmd = [
            'ffprobe',
            '-v', 'error',
            '-select_streams', 'v:0',
            '-count_packets',
            '-show_entries', 'stream=nb_read_packets',
            '-of', 'csv=p=0',
            video_path
        ]
        
        try:
            probe_result = subprocess.run(
                probe_cmd,
                capture_output=True,
                text=True,
                timeout=30,
                check=True
            )
            total_frames = int(probe_result.stdout.strip())
            
            if frame_number >= total_frames:
                return jsonify({
                    'error': f'Frame at index {frame_number} could not be found.'
                }), 404
        except (subprocess.CalledProcessError, ValueError, subprocess.TimeoutExpired):
            # If we can't get frame count, proceed anyway and let ffmpeg fail if needed
            pass
        
        # Extract the frame using ffmpeg
        ffmpeg_cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            output_path
        ]
        
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # Check if frame was extracted successfully
        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({
                'error': f'Frame at index {frame_number} could not be found.'
            }), 404
        
        # Send the extracted frame
        return send_file(
            output_path,
            mimetype='image/png',
            as_attachment=False,
            download_name=f'frame_{frame_number}.png'
        )
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Processing timeout'}), 500
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        # Clean up temporary directory
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>