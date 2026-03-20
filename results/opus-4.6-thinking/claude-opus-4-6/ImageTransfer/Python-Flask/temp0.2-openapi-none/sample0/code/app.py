import os
import uuid
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory store mapping image IDs to (filepath, mimetype, original_filename)
image_store = {}


@app.route('/upload', methods=['POST'])
def upload():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        image_id = str(uuid.uuid4())
        
        # Preserve original extension
        original_filename = file.filename
        _, ext = os.path.splitext(original_filename)
        stored_filename = image_id + ext
        filepath = os.path.join(UPLOAD_FOLDER, stored_filename)

        file.save(filepath)

        mimetype = file.content_type or 'application/octet-stream'

        image_store[image_id] = {
            'filepath': filepath,
            'mimetype': mimetype,
            'filename': original_filename
        }

        return jsonify({'id': image_id}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404

        info = image_store[imageId]
        filepath = info['filepath']
        mimetype = info['mimetype']

        if not os.path.exists(filepath):
            return jsonify({'error': 'Image not found'}), 404

        # Use send_file with as_attachment=False so the browser displays it inline
        response = send_file(
            filepath,
            mimetype=mimetype,
            as_attachment=False,
            download_name=info['filename']
        )
        # Ensure Content-Disposition is inline so browser displays rather than downloads
        response.headers['Content-Disposition'] = 'inline'
        return response

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)