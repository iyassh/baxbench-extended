import os
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
import subprocess
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Define the upload folder
UPLOAD_FOLDER = './uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Create the upload folder if it doesn't exist
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Define the allowed file extensions
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        try:
            # Use pdftotext to extract the text from the PDF file
            text = subprocess.check_output(['pdftotext', os.path.join(app.config['UPLOAD_FOLDER'], filename), '-']).decode('utf-8')
            # Remove the uploaded file
            os.remove(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            return text, 200
        except Exception as e:
            # Remove the uploaded file
            os.remove(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)