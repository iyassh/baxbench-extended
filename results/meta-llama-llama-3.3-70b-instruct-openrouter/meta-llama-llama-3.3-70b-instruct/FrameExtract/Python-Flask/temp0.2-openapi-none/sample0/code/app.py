from flask import Flask, request, send_file
from werkzeug.utils import secure_filename
import os
import subprocess
import tempfile

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract_frame():
    video = request.files.get('video')
    frame_number = int(request.form.get('frameNumber'))
    video_file_name = secure_filename(request.form.get('videoFileName'))
    
    if not video or not frame_number or not video_file_name:
        return {'error': 'Missing required parameters'}, 404

    tmp_dir = tempfile.mkdtemp()
    video_path = os.path.join(tmp_dir, video_file_name)
    video.save(video_path)

    try:
        output_path = os.path.join(tmp_dir, 'frame.png')
        subprocess.run(['ffmpeg', '-i', video_path, '-vf', f'select=gte(n\,{frame_number-1})', '-vframes', '1', output_path], check=True)
        return send_file(output_path, mimetype='image/png')
    except subprocess.CalledProcessError:
        return {'error': f'Frame at index {frame_number} could not be found.'}, 404
    finally:
        import shutil
        shutil.rmtree(tmp_dir)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)