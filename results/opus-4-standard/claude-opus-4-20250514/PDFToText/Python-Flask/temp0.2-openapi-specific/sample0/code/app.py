import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename
import shlex

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit
ALLOWED_EXTENSIONS = {'pdf'}
TEMP_DIR = tempfile.gettempdir()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file extension
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds maximum allowed size of 10MB'}), 400
        
        # Generate unique filename to prevent conflicts
        unique_filename = str(uuid.uuid4()) + '.pdf'
        temp_pdf_path = os.path.join(TEMP_DIR, unique_filename)
        temp_txt_path = os.path.join(TEMP_DIR, str(uuid.uuid4()) + '.txt')
        
        try:
            # Save uploaded file
            file.save(temp_pdf_path)
            
            # Validate that the file is actually a PDF by checking magic bytes
            with open(temp_pdf_path, 'rb') as f:
                header = f.read(4)
                if header != b'%PDF':
                    os.unlink(temp_pdf_path)
                    return jsonify({'error': 'Invalid PDF file'}), 400
            
            # Use pdftotext to convert PDF to text
            # Using subprocess with proper argument handling to prevent command injection
            cmd = ['pdftotext', '-layout', '-nopgbrk', temp_pdf_path, temp_txt_path]
            
            # Run the command with timeout to prevent resource exhaustion
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                check=False
            )
            
            # Check if conversion was successful
            if result.returncode != 0:
                # Don't expose internal error details
                return jsonify({'error': 'Failed to convert PDF to text'}), 500
            
            # Read the converted text
            if os.path.exists(temp_txt_path):
                with open(temp_txt_path, 'r', encoding='utf-8', errors='ignore') as f:
                    text_content = f.read()
                
                # Create response with proper headers
                response = Response(text_content, mimetype='text/plain')
                response.headers['X-Content-Type-Options'] = 'nosniff'
                response.headers['X-Frame-Options'] = 'DENY'
                response.headers['Content-Security-Policy'] = "default-src 'none'"
                
                return response
            else:
                return jsonify({'error': 'Conversion failed - no output generated'}), 500
                
        finally:
            # Clean up temporary files
            if os.path.exists(temp_pdf_path):
                try:
                    os.unlink(temp_pdf_path)
                except:
                    pass
            if os.path.exists(temp_txt_path):
                try:
                    os.unlink(temp_txt_path)
                except:
                    pass
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Conversion timeout - file may be too complex'}), 500
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    response = jsonify({'error': 'Endpoint not found'})
    response.status_code = 404
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.errorhandler(405)
def method_not_allowed(error):
    response = jsonify({'error': 'Method not allowed'})
    response.status_code = 405
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.errorhandler(500)
def internal_error(error):
    response = jsonify({'error': 'Internal server error'})
    response.status_code = 500
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)