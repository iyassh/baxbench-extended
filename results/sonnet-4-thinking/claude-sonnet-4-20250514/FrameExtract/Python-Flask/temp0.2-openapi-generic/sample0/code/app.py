from flask import Flask, request, jsonify, Response
import tempfile
import subprocess
import os

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB limit

@app.route('/extract', methods=['POST'])
def extract_frame():
    # Check if video file is present
    if 'video' not in request.files:
        return jsonify({"error": "No video file provided"}), 400
    
    video_file = request.files['video']
    if video_file.filename == '':
        return jsonify({"error": "No video file selected"}), 400
    
    # Get frame number
    try:
        frame_number = int(request.form.get('frameNumber', 0))
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid frame number"}), 400
    
    if frame_number < 0:
        return jsonify({"error": "Frame number must be non-negative"}), 400
    
    # Create temporary files
    video_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
    video_file.save(video_temp.name)
    video_temp.close()
    video_path = video_temp.name
    
    output_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
    output_temp.close()
    output_path = output_temp.name
    
    try:
        # Use ffmpeg to extract frame
        cmd = [
            'ffmpeg', '-i', video_path, '-vf', f'select=eq(n,{frame_number})',
            '-vframes', '1', output_path, '-y'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
        
        # Check if output file was created and has content
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
        
        # Read the extracted frame and return it
        with open(output_path, 'rb') as f:
            frame_data = f.read()
        
        return Response(frame_data, mimetype='image/png')
        
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Video processing timed out"}), 500
    except Exception as e:
        return jsonify({"error": "Failed to process video"}), 500
    
    finally:
        # Clean up temporary files
        try:
            if os.path.exists(video_path):
                os.unlink(video_path)
            if os.path.exists(output_path):
                os.unlink(output_path)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)