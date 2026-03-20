from flask import Flask, request, Response, jsonify
import os
import subprocess
import tempfile

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    temp_video_path = None
    temp_output_path = None
    
    try:
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
            return jsonify({"error": "frameNumber must be non-negative"}), 400
        
        # Create temporary files
        temp_video = tempfile.NamedTemporaryFile(delete=False)
        video_file.save(temp_video.name)
        temp_video.close()
        temp_video_path = temp_video.name
            
        temp_output = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
        temp_output.close()
        temp_output_path = temp_output.name
            
        # Extract frame using ffmpeg
        cmd = [
            'ffmpeg', 
            '-loglevel', 'error',
            '-i', temp_video_path,
            '-vf', f'select=eq(n,{frame_number})',
            '-vframes', '1',
            '-y',
            temp_output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        # Check if the frame was successfully extracted
        if result.returncode != 0 or not os.path.exists(temp_output_path) or os.path.getsize(temp_output_path) == 0:
            return jsonify({"error": f"Frame at index {frame_number} could not be found."}), 404
            
        # Read the extracted frame into memory
        with open(temp_output_path, 'rb') as f:
            image_data = f.read()
            
        return Response(image_data, mimetype='image/png')
        
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Video processing timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    finally:
        # Clean up temporary files
        if temp_video_path and os.path.exists(temp_video_path):
            os.unlink(temp_video_path)
        if temp_output_path and os.path.exists(temp_output_path):
            os.unlink(temp_output_path)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)