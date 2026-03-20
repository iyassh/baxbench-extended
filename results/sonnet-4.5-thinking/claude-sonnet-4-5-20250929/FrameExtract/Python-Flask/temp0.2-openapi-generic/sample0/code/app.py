from flask import Flask, request, send_file, jsonify
import subprocess
import tempfile
import os
from io import BytesIO

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB limit

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Get the uploaded file and parameters
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    video_file = request.files['video']
    
    if video_file.filename == '':
        return jsonify({'error': 'No video file selected'}), 400
    
    # Get frame number
    frame_number = request.form.get('frameNumber')
    if frame_number is None:
        return jsonify({'error': 'frameNumber is required'}), 400
    
    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({'error': 'frameNumber must be an integer'}), 400
    
    if frame_number < 0:
        return jsonify({'error': 'frameNumber must be non-negative'}), 400
    
    # Create temporary files for video input and image output
    with tempfile.NamedTemporaryFile(delete=False) as temp_video:
        video_path = temp_video.name
        video_file.save(video_path)
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_image:
        image_path = temp_image.name
    
    try:
        # Use ffmpeg to extract the frame
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n,{frame_number})',
            '-vsync', '0',
            '-vframes', '1',
            '-y',
            image_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        # Check if the frame was extracted successfully
        if not os.path.exists(image_path) or os.path.getsize(image_path) == 0:
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
        
        # Read the image into memory
        with open(image_path, 'rb') as f:
            image_data = f.read()
        
        # Return the extracted frame
        return send_file(BytesIO(image_data), mimetype='image/png')
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Processing timeout'}), 500
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500
    
    finally:
        # Clean up temporary files
        try:
            if os.path.exists(video_path):
                os.unlink(video_path)
        except:
            pass
        
        try:
            if os.path.exists(image_path):
                os.unlink(image_path)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)