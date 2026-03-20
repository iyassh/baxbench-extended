import os
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Check if video file is in the request
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    video_file = request.files['video']
    
    # Get frame number from form data
    frame_number = request.form.get('frameNumber')
    if not frame_number:
        return jsonify({'error': 'Frame number not provided'}), 400
    
    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({'error': 'Invalid frame number'}), 400
    
    # Create temporary directory for processing
    with tempfile.TemporaryDirectory() as temp_dir:
        # Save uploaded video to temporary file
        video_filename = secure_filename(video_file.filename) if video_file.filename else 'video.mp4'
        video_path = os.path.join(temp_dir, video_filename)
        video_file.save(video_path)
        
        # Output image path
        output_image_path = os.path.join(temp_dir, 'frame.png')
        
        # Use ffmpeg to extract the specific frame
        # ffmpeg uses 0-based indexing for frames
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-loglevel', 'error',
            output_image_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            
            # Check if the output image was created
            if os.path.exists(output_image_path) and os.path.getsize(output_image_path) > 0:
                # Read the image file and return it
                with open(output_image_path, 'rb') as f:
                    image_data = f.read()
                
                return send_file(
                    io.BytesIO(image_data),
                    mimetype='image/png',
                    as_attachment=False
                )
            else:
                # Frame not found or extraction failed
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
                
        except Exception as e:
            return jsonify({'error': f'Error processing video: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)