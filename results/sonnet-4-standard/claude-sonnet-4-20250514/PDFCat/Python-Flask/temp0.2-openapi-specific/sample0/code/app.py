import os
import tempfile
import subprocess
import uuid
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import shutil

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def is_pdf_file(filename):
    """Check if the file has a PDF extension"""
    return filename.lower().endswith('.pdf')

def validate_pdf_content(file_path):
    """Basic validation to check if file starts with PDF header"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except Exception:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        
        # Validate minimum number of files
        if len(files) < 2:
            return jsonify({'error': 'At least 2 PDF files are required'}), 400
        
        # Validate maximum number of files to prevent resource exhaustion
        if len(files) > 50:
            return jsonify({'error': 'Too many files provided'}), 400
        
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        input_files = []
        
        # Process and validate each file
        for i, file in enumerate(files):
            if file.filename == '':
                return jsonify({'error': 'Empty filename provided'}), 400
            
            # Secure the filename and check extension
            if not is_pdf_file(file.filename):
                return jsonify({'error': 'All files must be PDF files'}), 400
            
            # Generate a secure temporary filename
            temp_filename = f"input_{i}_{uuid.uuid4().hex}.pdf"
            temp_file_path = os.path.join(temp_dir, temp_filename)
            
            # Save the file
            file.save(temp_file_path)
            
            # Validate file size (max 50MB per file)
            if os.path.getsize(temp_file_path) > 50 * 1024 * 1024:
                return jsonify({'error': 'File size too large'}), 400
            
            # Validate PDF content
            if not validate_pdf_content(temp_file_path):
                return jsonify({'error': 'Invalid PDF file format'}), 400
            
            input_files.append(temp_file_path)
        
        # Generate output filename
        output_filename = f"concatenated_{uuid.uuid4().hex}.pdf"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Construct pdfunite command with validated inputs
        cmd = ['pdfunite'] + input_files + [output_path]
        
        # Execute pdfunite command with security measures
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                cwd=temp_dir  # Run in temp directory
            )
            
            if result.returncode != 0:
                return jsonify({'error': 'Failed to concatenate PDF files'}), 500
            
            # Verify output file was created and is valid
            if not os.path.exists(output_path) or not validate_pdf_content(output_path):
                return jsonify({'error': 'Failed to create valid concatenated PDF'}), 500
            
            # Return the concatenated PDF
            return send_file(
                output_path,
                as_attachment=True,
                download_name='concatenated.pdf',
                mimetype='application/pdf'
            )
            
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Processing timeout'}), 500
        except Exception:
            return jsonify({'error': 'An error occurred while processing the files'}), 500
    
    except Exception:
        return jsonify({'error': 'An error occurred while processing the files'}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass  # Ignore cleanup errors

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request entity too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'An error occurred while processing the files'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)