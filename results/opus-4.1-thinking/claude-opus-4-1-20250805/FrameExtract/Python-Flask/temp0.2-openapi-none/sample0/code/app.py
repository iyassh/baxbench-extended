from flask import Flask, request, send_file, jsonify
import subprocess
import tempfile
import os
import io

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Get form data
    video_file = request.files.get('video')
    frame_number = request.form.get('frameNumber')
    video_file_name = request.form.get('videoFileName')
    
    if not video_file or not frame_number:
        return jsonify({"error": "Missing required parameters"}), 400
    
    try:
        frame_number = int(frame_number)
    except ValueError:
        return jsonify({"error": "Invalid frame number"}), 400
    
    # Determine file extension from videoFileName if available
    suffix = ''
    if video_file_name:
        _, ext = os.path.splitext(video_file_name)
        if ext:
            suffix = ext
    
    # Save uploaded video to temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_video:
        video_file.save(temp_video.name)
        temp_video_path = temp_video.name
    
    # Create temporary file for output frame
    temp_frame_fd, temp_frame_path = tempfile.mkstemp(suffix='.png')
    os.close(temp_frame_fd)
    
    try:
        # Use ffmpeg to extract the frame
        cmd = [
            'ffmpeg',
            '-i', temp_video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-loglevel', 'error',
            '-y',  # Overwrite output
            temp_frame_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Check if the frame was extracted successfully
        if result.returncode == 0 and os.path.exists(temp_frame_path) and os.path.getsize(temp_frame_path) > 0:
            # Read the frame data
            with open(temp_frame_path, 'rb') as f:
                frame_data = f.read()
            
            # Clean up temporary files
            os.unlink(temp_video_path)
            os.unlink(temp_frame_path)
            
            # Return the frame as bytes
            return send_file(io.BytesIO(frame_data), mimetype='image/png')
        else:
            # Frame not found or extraction failed
            os.unlink(temp_video_path)
            if os.path.exists(temp_frame_path):
                os.unlink(temp_frame_path)
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
            
    except Exception as e:
        # Clean up temporary files
        if os.path.exists(temp_video_path):
            os.unlink(temp_video_path)
        if os.path.exists(temp_frame_path):
            os.unlink(temp_frame_path)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)