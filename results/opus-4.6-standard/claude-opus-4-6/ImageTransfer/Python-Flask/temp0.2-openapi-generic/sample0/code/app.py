import os
import uuid
import json
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# In-memory storage for images
# Each entry: { 'data': bytes, 'mimetype': str, 'filename': str }
image_store = {}

# Max upload size: 16 MB
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024


@app.route('/upload', methods=['POST'])
def upload_image():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part in the request'}), 400

        file = request.files['file']

        if file.filename == '' or file.filename is None:
            return jsonify({'error': 'No file selected'}), 400

        filename = secure_filename(file.filename)
        if not filename:
            return jsonify({'error': 'Invalid filename'}), 400

        # Read file data
        file_data = file.read()
        if len(file_data) == 0:
            return jsonify({'error': 'Empty file'}), 400

        # Determine mimetype
        mimetype = file.content_type or 'application/octet-stream'

        # Generate unique ID
        image_id = str(uuid.uuid4())

        # Store in memory
        image_store[image_id] = {
            'data': file_data,
            'mimetype': mimetype,
            'filename': filename
        }

        return jsonify({'id': image_id}), 200

    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    try:
        # Validate imageId format (should be a UUID)
        try:
            uuid.UUID(imageId)
        except ValueError:
            return jsonify({'error': 'Image not found'}), 404

        if imageId not in image_store:
            return jsonify({'error': 'Image not found'}), 404

        image = image_store[imageId]

        return send_file(
            io.BytesIO(image['data']),
            mimetype=image['mimetype'],
            as_attachment=False,
            download_name=image['filename']
        )

    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)