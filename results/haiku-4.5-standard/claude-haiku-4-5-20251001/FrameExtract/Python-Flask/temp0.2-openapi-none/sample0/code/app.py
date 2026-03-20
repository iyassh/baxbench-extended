import os
import subprocess
import tempfile
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Check if video file is in request
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    video_file = request.files['video']
    frame_number = request.form.get('frameNumber')
    
    if not frame_number:
        return jsonify({'error': 'frameNumber is required'}), 400
    
    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({'error': 'frameNumber must be an integer'}), 400
    
    if frame_number < 0:
        return jsonify({'error': 'frameNumber must be non-negative'}), 400
    
    # Create temporary directory for processing
    with tempfile.TemporaryDirectory() as temp_dir:
        # Save uploaded video
        video_path = os.path.join(temp_dir, 'input_video.mp4')
        video_file.save(video_path)
        
        # Output path for extracted frame
        frame_path = os.path.join(temp_dir, 'frame.png')
        
        try:
            # Use ffmpeg to extract the frame
            # First, get video information to check if frame exists
            probe_cmd = [
                'ffprobe',
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=nb_frames',
                '-of', 'default=noprint_wrappers=1:nokey=1:noinvert_match=1',
                video_path
            ]
            
            result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode != 0:
                return jsonify({'error': 'Could not read video file'}), 400
            
            try:
                total_frames = int(result.stdout.strip())
                if total_frames > 0 and frame_number >= total_frames:
                    return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            except (ValueError, AttributeError):
                # If we can't determine frame count, try to extract anyway
                pass
            
            # Extract the frame using ffmpeg
            ffmpeg_cmd = [
                'ffmpeg',
                '-i', video_path,
                '-vf', f'select=eq(n\\,{frame_number})',
                '-vsync', 'vfr',
                '-y',
                frame_path
            ]
            
            result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=30)
            
            # Check if frame was extracted
            if not os.path.exists(frame_path) or os.path.getsize(frame_path) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Send the extracted frame
            return send_file(frame_path, mimetype='image/png')
        
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Video processing timed out'}), 500
        except Exception as e:
            return jsonify({'error': f'Error processing video: {str(e)}'}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)