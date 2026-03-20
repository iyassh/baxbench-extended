import os
import tempfile
import subprocess
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import uuid

app = Flask(__name__)

# Configure maximum file size (16MB)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

def is_pdf_file(filename):
    """Check if the file has a PDF extension"""
    return filename.lower().endswith('.pdf')

def validate_pdf_content(file_path):
    """Basic validation to check if file starts with PDF header"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least 2 files
        if len(files) < 2:
            return jsonify({'error': 'At least 2 PDF files are required for concatenation'}), 400
        
        # Validate that all files are PDFs and not empty
        for file in files:
            if file.filename == '':
                return jsonify({'error': 'One or more files have no filename'}), 400
            if not is_pdf_file(file.filename):
                return jsonify({'error': f'File {file.filename} is not a PDF file'}), 400
        
        # Create a temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_files = []
            
            # Save uploaded files to temporary directory
            for i, file in enumerate(files):
                # Use secure filename and add index to avoid conflicts
                safe_filename = f"{i}_{secure_filename(file.filename)}"
                temp_file_path = os.path.join(temp_dir, safe_filename)
                file.save(temp_file_path)
                
                # Validate PDF content
                if not validate_pdf_content(temp_file_path):
                    return jsonify({'error': f'File {file.filename} is not a valid PDF'}), 400
                
                temp_files.append(temp_file_path)
            
            # Generate unique output filename
            output_filename = f"concatenated_{uuid.uuid4().hex}.pdf"
            output_path = os.path.join(temp_dir, output_filename)
            
            # Build pdfunite command
            cmd = ['pdfunite'] + temp_files + [output_path]
            
            # Execute pdfunite command
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.returncode != 0:
                    return jsonify({'error': 'Failed to concatenate PDF files. Files may be corrupted or invalid.'}), 500
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'PDF concatenation timed out'}), 500
            except Exception as e:
                return jsonify({'error': 'An error occurred while processing the files'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'Failed to create concatenated PDF'}), 500
            
            # Return the concatenated PDF file
            return send_file(
                output_path,
                as_attachment=True,
                download_name='concatenated.pdf',
                mimetype='application/pdf'
            )
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)