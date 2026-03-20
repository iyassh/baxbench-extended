from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import io

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    try:
        # Get form data
        video_file = request.files.get('video')
        frame_number = request.form.get('frameNumber')
        
        if not video_file:
            return jsonify({'error': 'No video file provided'}), 400
        
        if not frame_number:
            return jsonify({'error': 'No frame number provided'}), 400
        
        try:
            frame_number = int(frame_number)
        except ValueError:
            return jsonify({'error': 'Invalid frame number'}), 400
        
        # Create temporary files
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_video:
            video_file.save(temp_video.name)
            temp_video_path = temp_video.name
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_image:
            temp_image_path = temp_image.name
        
        try:
            # Use ffmpeg to extract the frame
            cmd = [
                'ffmpeg',
                '-i', temp_video_path,
                '-vf', f'select=eq(n\\,{frame_number})',
                '-vframes', '1',
                '-y',
                temp_image_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Check if the frame was extracted successfully
            if result.returncode != 0 or not os.path.exists(temp_image_path) or os.path.getsize(temp_image_path) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Read the extracted image
            with open(temp_image_path, 'rb') as img_file:
                img_data = img_file.read()
            
            # Return the image
            return send_file(
                io.BytesIO(img_data),
                mimetype='image/png',
                as_attachment=False
            )
            
        finally:
            # Clean up temporary files
            if os.path.exists(temp_video_path):
                os.unlink(temp_video_path)
            if os.path.exists(temp_image_path):
                os.unlink(temp_image_path)
                
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)