from flask import Flask, request, jsonify, make_response
import os
import subprocess
import tempfile
import secrets

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Maximum file size: 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024

def validate_pdf_file(file):
    """Validate that the uploaded file is a PDF"""
    if not file:
        return False, "No file provided"
    
    if file.filename == '':
        return False, "No file selected"
    
    # Check file extension
    if not file.filename.lower().endswith('.pdf'):
        return False, "File must be a PDF"
    
    # Read first few bytes to check PDF magic number
    file.seek(0)
    header = file.read(5)
    file.seek(0)
    
    if header != b'%PDF-':
        return False, "Invalid PDF file"
    
    return True, None

def convert_pdf_to_text(pdf_path):
    """Convert PDF to text using pdftotext utility"""
    try:
        # Use subprocess with explicit arguments to prevent command injection
        # -layout preserves layout, -nopgbrk removes page breaks
        result = subprocess.run(
            ['pdftotext', '-layout', '-nopgbrk', pdf_path, '-'],
            capture_output=True,
            timeout=30,  # Prevent resource exhaustion
            check=False
        )
        
        if result.returncode != 0:
            return None, "PDF conversion failed"
        
        return result.stdout.decode('utf-8', errors='replace'), None
    except subprocess.TimeoutExpired:
        return None, "Conversion timeout"
    except Exception:
        return None, "Conversion error"

@app.route('/convert', methods=['POST'])
def convert():
    temp_file_path = None
    
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Validate file
        is_valid, error_msg = validate_pdf_file(file)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        # Check file size by reading in chunks
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large'}), 400
        
        if file_size == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Create a secure temporary file with random name
        # Use a secure random filename to prevent path traversal
        random_name = secrets.token_hex(16)
        temp_dir = tempfile.gettempdir()
        temp_file_path = os.path.join(temp_dir, f"{random_name}.pdf")
        
        # Ensure the path is within temp directory (prevent path traversal)
        real_temp_dir = os.path.realpath(temp_dir)
        real_temp_file = os.path.realpath(temp_file_path)
        if not real_temp_file.startswith(real_temp_dir):
            return jsonify({'error': 'Invalid file path'}), 400
        
        # Save uploaded file to temporary location
        file.save(temp_file_path)
        
        # Convert PDF to text
        text_content, error = convert_pdf_to_text(temp_file_path)
        
        if error:
            return jsonify({'error': 'Conversion failed'}), 500
        
        # Return plain text response
        response = make_response(text_content, 200)
        response.headers['Content-Type'] = 'text/plain; charset=utf-8'
        return response
        
    except Exception:
        # Generic error message to avoid information disclosure
        return jsonify({'error': 'An error occurred'}), 500
    
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Configure max content length
    app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE
    app.run(host='0.0.0.0', port=5000)