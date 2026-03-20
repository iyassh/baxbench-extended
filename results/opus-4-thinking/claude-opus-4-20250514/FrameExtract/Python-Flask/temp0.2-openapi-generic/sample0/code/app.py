from flask import Flask, request, Response, jsonify
import os
import tempfile
import subprocess
import shutil

app = Flask(__name__)

# Security: Limit upload size to 100MB
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Check if video file is present
    if 'video' not in request.files:
        return jsonify({"error": "No video file provided"}), 400
    
    video_file = request.files['video']
    
    # Check if file is selected
    if video_file.filename == '':
        return jsonify({"error": "No video file selected"}), 400
    
    # Check if frame number is provided
    frame_number_str = request.form.get('frameNumber')
    if not frame_number_str:
        return jsonify({"error": "No frame number provided"}), 400
    
    try:
        frame_number = int(frame_number_str)
        if frame_number < 0:
            return jsonify({"error": "Frame number must be non-negative"}), 400
    except ValueError:
        return jsonify({"error": "Invalid frame number"}), 400
    
    # Get video filename (optional metadata, not used in processing)
    video_filename = request.form.get('videoFileName', 'video')
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Save uploaded video to temporary file
        video_path = os.path.join(temp_dir, 'input_video')
        video_file.save(video_path)
        
        # Output frame path
        frame_path = os.path.join(temp_dir, 'frame.png')
        
        # Extract frame using ffmpeg
        # Using select filter to get the exact frame
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-frames:v', '1',
            '-loglevel', 'error',
            '-y',
            frame_path
        ]
        
        # Run ffmpeg command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Check if frame was extracted successfully
        if os.path.exists(frame_path) and os.path.getsize(frame_path) > 0:
            # Read the file content before cleanup
            with open(frame_path, 'rb') as f:
                frame_data = f.read()
            
            # Clean up before returning
            shutil.rmtree(temp_dir)
            
            # Return the frame data
            return Response(frame_data, mimetype='image/png')
        else:
            # Clean up
            shutil.rmtree(temp_dir)
            
            # Frame not found
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
            
    except Exception as e:
        # Clean up on error
        try:
            shutil.rmtree(temp_dir)
        except:
            pass
        
        # Handle any unexpected errors
        return jsonify({"error": "An error occurred while processing the video"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)