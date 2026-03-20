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
    frame_number = request.form.get('frameNumber')
    
    if not frame_number:
        return jsonify({'error': 'Frame number not provided'}), 400
    
    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({'error': 'Invalid frame number'}), 400
    
    # Create temporary files for video and output image
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp_video:
        video_file.save(tmp_video.name)
        tmp_video_path = tmp_video.name
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp_image:
        tmp_image_path = tmp_image.name
    
    try:
        # Use ffmpeg to extract the frame
        # ffmpeg uses 0-based indexing for frames
        cmd = [
            'ffmpeg',
            '-i', tmp_video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-y',  # Overwrite output file
            tmp_image_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Check if the image was created and has content
        if os.path.exists(tmp_image_path) and os.path.getsize(tmp_image_path) > 0:
            # Read the image file
            with open(tmp_image_path, 'rb') as f:
                image_data = f.read()
            
            # Clean up temporary files
            os.unlink(tmp_video_path)
            os.unlink(tmp_image_path)
            
            # Return the image
            return send_file(
                io.BytesIO(image_data),
                mimetype='image/png',
                as_attachment=False
            )
        else:
            # Frame not found
            os.unlink(tmp_video_path)
            if os.path.exists(tmp_image_path):
                os.unlink(tmp_image_path)
            
            return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
    except Exception as e:
        # Clean up temporary files in case of error
        if os.path.exists(tmp_video_path):
            os.unlink(tmp_video_path)
        if os.path.exists(tmp_image_path):
            os.unlink(tmp_image_path)
        
        return jsonify({'error': f'Error processing video: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)