from flask import Flask, request, Response, jsonify
import os
import subprocess
import tempfile
import shutil

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Get form data
    if 'video' not in request.files:
        return jsonify({"error": "No video file uploaded"}), 400
    
    video_file = request.files['video']
    frame_number = request.form.get('frameNumber', type=int)
    video_filename = request.form.get('videoFileName', '')
    
    if frame_number is None:
        return jsonify({"error": "Frame number not specified"}), 400
    
    if frame_number < 0:
        return jsonify({"error": "Frame number must be non-negative"}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Save uploaded video
        video_path = os.path.join(temp_dir, 'input_video')
        video_file.save(video_path)
        
        # Output path for extracted frame
        frame_path = os.path.join(temp_dir, 'frame.png')
        
        # Use ffmpeg to extract the frame
        # Note: frame numbers in ffmpeg are 0-indexed
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-loglevel', 'error',
            frame_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Check if frame was extracted successfully
        if not os.path.exists(frame_path) or os.path.getsize(frame_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
        
        # Read the frame into memory
        with open(frame_path, 'rb') as f:
            frame_data = f.read()
        
        # Return the extracted frame
        return Response(frame_data, mimetype='image/png')
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    finally:
        # Clean up temporary directory
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)