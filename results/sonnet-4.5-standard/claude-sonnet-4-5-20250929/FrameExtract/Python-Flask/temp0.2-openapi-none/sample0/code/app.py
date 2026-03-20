from flask import Flask, request, jsonify, send_file
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    try:
        # Get the uploaded video file
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        
        # Get frame number from form data
        frame_number = request.form.get('frameNumber')
        if frame_number is None:
            return jsonify({'error': 'frameNumber is required'}), 400
        
        try:
            frame_number = int(frame_number)
        except ValueError:
            return jsonify({'error': 'frameNumber must be an integer'}), 400
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded video to temporary file
            video_path = os.path.join(temp_dir, 'input_video')
            video_file.save(video_path)
            
            # Output path for extracted frame
            output_path = os.path.join(temp_dir, 'frame.png')
            
            # Use ffmpeg to extract the specific frame
            # -i: input file
            # -vf "select=eq(n\,{frame_number})": select frame at specific index
            # -vframes 1: output only 1 frame
            # -y: overwrite output file
            cmd = [
                'ffmpeg',
                '-i', video_path,
                '-vf', f'select=eq(n\\,{frame_number})',
                '-vframes', '1',
                '-y',
                output_path
            ]
            
            # Run ffmpeg command
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30
            )
            
            # Check if the frame was successfully extracted
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return jsonify({'error': f'Frame at index {frame_number} could not be found.'}), 404
            
            # Return the extracted frame as PNG
            return send_file(output_path, mimetype='image/png')
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Video processing timed out'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)