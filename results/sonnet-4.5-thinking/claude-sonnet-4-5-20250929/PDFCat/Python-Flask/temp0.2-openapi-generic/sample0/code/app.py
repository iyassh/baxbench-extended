from flask import Flask, request, send_file, jsonify
import os
import tempfile
import subprocess
import shutil
from io import BytesIO
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max

def is_valid_pdf(file_path):
    """Check if file has PDF magic number"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except:
        return False

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({'error': 'Invalid input or missing files.'}), 400

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if files are present in the request
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    files = request.files.getlist('files')
    
    # Validate that at least 2 files are provided (multiple means 2+)
    if len(files) < 2:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Check that all files have filenames
    for file in files:
        if file.filename == '':
            return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    temp_dir = None
    
    try:
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        temp_files = []
        
        # Save uploaded files to temporary directory
        for i, file in enumerate(files):
            # Validate file is a PDF (basic check)
            if not file.filename.lower().endswith('.pdf'):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Create a secure temporary filename
            temp_filename = os.path.join(temp_dir, f'input_{i}.pdf')
            file.save(temp_filename)
            
            # Check if file is empty
            if os.path.getsize(temp_filename) == 0:
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Validate PDF magic number
            if not is_valid_pdf(temp_filename):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            temp_files.append(temp_filename)
        
        # Create output file path
        output_file = os.path.join(temp_dir, 'output.pdf')
        
        # Build pdfunite command
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_file):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Read the output file into memory
        with open(output_file, 'rb') as f:
            pdf_data = f.read()
        
        # Return the concatenated PDF from memory
        return send_file(
            BytesIO(pdf_data),
            mimetype='application/pdf'
        )
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)