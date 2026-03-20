import os
import tempfile
import subprocess
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def is_valid_pdf(filepath):
    """Check if file is a valid PDF by checking magic bytes"""
    try:
        with open(filepath, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least 2 files
        if len(files) < 2:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            saved_files = []
            
            # Save and validate each uploaded file
            for idx, file in enumerate(files):
                if file.filename == '':
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Validate file extension
                if not allowed_file(file.filename):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Secure the filename
                filename = secure_filename(f"input_{idx}.pdf")
                filepath = os.path.join(temp_dir, filename)
                
                # Save the file
                file.save(filepath)
                
                # Check file size
                if os.path.getsize(filepath) > MAX_FILE_SIZE:
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Validate it's actually a PDF
                if not is_valid_pdf(filepath):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                saved_files.append(filepath)
            
            # Create output filename
            output_path = os.path.join(temp_dir, 'concatenated.pdf')
            
            # Build pdfunite command
            cmd = ['pdfunite'] + saved_files + [output_path]
            
            # Execute pdfunite
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,  # 30 second timeout
                    check=True
                )
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            except subprocess.CalledProcessError as e:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Return the concatenated PDF
            return send_file(
                output_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name='concatenated.pdf'
            )
            
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Invalid input or missing files.'}), 400

if __name__ == '__main__':
    app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE
    app.run(host='0.0.0.0', port=5000, debug=False)