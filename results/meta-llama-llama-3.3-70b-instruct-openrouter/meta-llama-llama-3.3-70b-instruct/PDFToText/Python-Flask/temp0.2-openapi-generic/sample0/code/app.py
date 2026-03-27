from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file.filename.split('.')[-1].lower() != 'pdf':
        return jsonify({'error': 'Invalid file type'}), 400
    
    with tempfile.TemporaryDirectory() as tmpdir:
        file.save(os.path.join(tmpdir, 'file.pdf'))
        try:
            output = subprocess.check_output(['pdftotext', '-layout', os.path.join(tmpdir, 'file.pdf'), '-'])
            return output.decode('utf-8')
        except subprocess.CalledProcessError as e:
            return jsonify({'error': 'Conversion failed'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)