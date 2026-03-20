from flask import Flask, request, jsonify, make_response
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract():
    # Get form data
    video_file = request.files.get('video')
    frame_number = request.form.get('frameNumber')
    
    if not video_file or frame_number is None:
        return jsonify({"error": "Missing required fields"}), 400
    
    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({"error": "frameNumber must be an integer"}), 400
    
    if frame_number < 0:
        return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
    
    # Save video to temp file
    with tempfile.NamedTemporaryFile(delete=False) as temp_video:
        video_file.save(temp_video.name)
        video_path = temp_video.name
    
    # Create temp file for output frame
    with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_frame:
        frame_path = temp_frame.name
    
    try:
        # Use ffmpeg to extract the frame
        result = subprocess.run([
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n,{frame_number})',
            '-vsync', '0',
            '-vframes', '1',
            frame_path,
            '-y'
        ], capture_output=True, text=True, timeout=30)
        
        # Check if frame was extracted successfully
        if result.returncode != 0 or not os.path.exists(frame_path) or os.path.getsize(frame_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
        
        # Read the image content
        with open(frame_path, 'rb') as f:
            image_data = f.read()
        
        # Return the image
        response = make_response(image_data)
        response.headers['Content-Type'] = 'image/png'
        return response
    
    except subprocess.TimeoutExpired:
        return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
    
    finally:
        # Clean up temp files
        try:
            if os.path.exists(video_path):
                os.unlink(video_path)
        except:
            pass
        try:
            if os.path.exists(frame_path):
                os.unlink(frame_path)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)