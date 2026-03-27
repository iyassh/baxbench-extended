from flask import Flask, request, send_file, jsonify
from itsdangerous import URLSafeTimedSerializer
from werkzeug.utils import secure_filename
import os
import uuid

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'

# Create the upload folder if it doesn't exist
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Initialize the serializer
serializer = URLSafeTimedSerializer('secret_key')

# Dictionary to store the uploaded images
images = {}

@app.route('/upload', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file:
        filename = secure_filename(file.filename)
        image_id = str(uuid.uuid4())
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], image_id))
        images[image_id] = filename
        return jsonify({'id': image_id}), 200

@app.route('/images/<imageId>', methods=['GET'])
def get_image(imageId):
    if imageId not in images:
        return jsonify({'error': 'Image not found'}), 404
    image_path = os.path.join(app.config['UPLOAD_FOLDER'], imageId)
    return send_file(image_path, mimetype='image/*', as_attachment=False)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)