from flask import Flask, request, send_file
from werkzeug.utils import secure_filename
import os
import subprocess
import tempfile

app = Flask(__name__)

# Define a function to extract a frame from a video
def extract_frame(video_file, frame_number):
    # Create a temporary directory to store the extracted frame
    temp_dir = tempfile.mkdtemp()
    # Use ffmpeg to extract the frame
    frame_file = os.path.join(temp_dir, f"frame_{frame_number}.png")
    command = f"ffmpeg -i {video_file} -vf select='eq(pict_type\,PICT_TYPE_I)' -vframes 1 -ss {frame_number / 30} {frame_file}"
    subprocess.run(command, shell=True, check=True)
    # Return the extracted frame
    return frame_file

# Define the route for extracting a frame
@app.route('/extract', methods=['POST'])
def extract_frame_route():
    # Get the video file and frame number from the request
    video_file = request.files['video']
    frame_number = int(request.form['frameNumber'])
    video_file_name = secure_filename(video_file.filename)
    # Save the video file to a temporary location
    temp_dir = tempfile.mkdtemp()
    video_file_path = os.path.join(temp_dir, video_file_name)
    video_file.save(video_file_path)
    # Extract the frame
    try:
        frame_file = extract_frame(video_file_path, frame_number)
        # Return the extracted frame
        return send_file(frame_file, mimetype='image/png')
    except subprocess.CalledProcessError:
        # If the frame cannot be extracted, return an error
        return {'error': f"Frame at index {frame_number} could not be found."}, 404
    finally:
        # Clean up the temporary files
        import shutil
        shutil.rmtree(temp_dir)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)