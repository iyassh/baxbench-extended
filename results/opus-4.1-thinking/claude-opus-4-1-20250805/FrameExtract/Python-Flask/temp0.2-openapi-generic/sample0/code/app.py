from flask import Flask, request, jsonify, send_file
import subprocess
import tempfile
import os
import shutil
import io

app = Flask(__name__)

# Configure max file size (e.g., 100MB)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Check required fields
    if 'video' not in request.files:
        return jsonify({"error": "No video file uploaded"}), 400
    
    if 'frameNumber' not in request.form:
        return jsonify({"error": "frameNumber not provided"}), 400
    
    video_file = request.files['video']
    
    # Check if file is actually uploaded
    if video_file.filename == '':
        return jsonify({"error": "No video file selected"}), 400
    
    # Validate frame number
    try:
        frame_number = int(request.form['frameNumber'])
        if frame_number < 0:
            return jsonify({"error": "Frame number must be non-negative"}), 400
    except ValueError:
        return jsonify({"error": "Invalid frame number"}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Save uploaded video to temp file
        video_path = os.path.join(temp_dir, 'input_video')
        video_file.save(video_path)
        
        # Output image path
        output_path = os.path.join(temp_dir, 'frame.png')
        
        # Use ffmpeg to extract frame
        # Using select filter to get specific frame number (0-indexed)
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'select=eq(n\\,{frame_number})',
            '-vframes', '1',
            '-f', 'image2',
            output_path,
            '-y',  # Overwrite output file if exists
            '-loglevel', 'error'  # Reduce verbosity
        ]
        
        # Run ffmpeg command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
        
        # Check if frame was successfully extracted
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
        
        # Read the file into memory
        with open(output_path, 'rb') as f:
            img_data = f.read()
        
        # Return the extracted frame from memory
        return send_file(
            io.BytesIO(img_data),
            mimetype='image/png',
            as_attachment=False
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Video processing timed out"}), 500
    except Exception as e:
        return jsonify({"error": f"Error processing video: {str(e)}"}), 500
    finally:
        # Always clean up temp directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)