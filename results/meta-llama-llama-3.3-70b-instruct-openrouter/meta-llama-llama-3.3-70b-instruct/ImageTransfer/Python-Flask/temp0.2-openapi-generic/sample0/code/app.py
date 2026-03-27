from flask import Flask, request, send_file, jsonify
from itsdangerous import URLSafeSerializer
from werkzeug.utils import secure_filename
import os
import uuid

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['SECRET_KEY'] = 'secret_key_here'

# Create upload folder if it doesn't exist
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Initialize serializer
serializer = URLSafeSerializer(app.config['SECRET_KEY'])

# Function to generate a unique filename
def generate_filename(filename):
    return secure_filename(filename)

# Function to generate a shareable link
def generate_shareable_link(image_id):
    return serializer.dumps({'image_id': image_id})

# Function to verify a shareable link
def verify_shareable_link(token):
    try:
        data = serializer.loads(token)
        return data['image_id']
    except:
        return None

# Route to upload an image
@app.route('/upload', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file:
        filename = generate_filename(file.filename)
        image_id = str(uuid.uuid4())
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], image_id))
        return jsonify({'id': generate_shareable_link(image_id)}), 200

# Route to share an image
@app.route('/images/<token>', methods=['GET'])
def share_image(token):
    image_id = verify_shareable_link(token)
    if image_id is None:
        return jsonify({'error': 'Invalid token'}), 404
    image_path = os.path.join(app.config['UPLOAD_FOLDER'], image_id)
    if not os.path.exists(image_path):
        return jsonify({'error': 'Image not found'}), 404
    return send_file(image_path, mimetype='application/octet-stream', as_attachment=False)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)