import os
import tempfile
import subprocess
import mimetypes
from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size
ALLOWED_EXTENSIONS = {'pdf'}
ALLOWED_MIME_TYPES = {'application/pdf', 'application/x-pdf'}
SUBPROCESS_TIMEOUT = 30  # seconds

def allowed_file(filename):
    """Check if file has allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_pdf_content(file_path):
    """Validate that the file is actually a PDF by checking magic bytes"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except Exception:
        return False

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    """Handle file size exceeded error"""
    return jsonify({'error': 'File size exceeds maximum allowed size'}), 400

@app.errorhandler(Exception)
def handle_general_error(e):
    """Generic error handler to avoid information leakage"""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'error': 'Internal server error occurred'}), 500

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    """Convert uploaded PDF file to text"""
    temp_pdf_path = None
    temp_txt_path = None
    
    try:
        # Validate that a file was uploaded
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Validate that a file was selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file extension
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file format. Only PDF files are allowed'}), 400
        
        # Validate MIME type
        file_mime = file.content_type
        if file_mime not in ALLOWED_MIME_TYPES:
            return jsonify({'error': 'Invalid file format. Only PDF files are allowed'}), 400
        
        # Create secure temporary file for PDF
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.pdf', delete=False) as temp_pdf:
            temp_pdf_path = temp_pdf.name
            
            # Save uploaded file
            file.save(temp_pdf_path)
        
        # Validate PDF content by checking magic bytes
        if not validate_pdf_content(temp_pdf_path):
            return jsonify({'error': 'Invalid PDF file'}), 400
        
        # Create temporary file for output text
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as temp_txt:
            temp_txt_path = temp_txt.name
        
        # Prepare pdftotext command with safe arguments
        cmd = [
            'pdftotext',
            '-layout',  # Maintain layout
            '-nopgbrk',  # Don't insert page breaks
            temp_pdf_path,
            temp_txt_path
        ]
        
        # Execute pdftotext with timeout and capture errors
        try:
            result = subprocess.run(
                cmd,
                shell=False,  # Prevent shell injection
                capture_output=True,
                text=True,
                timeout=SUBPROCESS_TIMEOUT,
                check=True
            )
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'PDF processing timeout'}), 500
        except subprocess.CalledProcessError:
            return jsonify({'error': 'Failed to process PDF file'}), 500
        except FileNotFoundError:
            return jsonify({'error': 'PDF processing tool not available'}), 500
        
        # Read the extracted text
        try:
            with open(temp_txt_path, 'r', encoding='utf-8', errors='ignore') as f:
                extracted_text = f.read()
        except Exception:
            return jsonify({'error': 'Failed to read extracted text'}), 500
        
        # Return the text as plain text response
        return Response(extracted_text, mimetype='text/plain', status=200)
        
    except RequestEntityTooLarge:
        return jsonify({'error': 'File size exceeds maximum allowed size'}), 400
    except Exception:
        # Log the actual error for debugging but don't expose it
        app.logger.error(f"Unexpected error during PDF conversion")
        return jsonify({'error': 'Failed to process PDF file'}), 500
    
    finally:
        # Clean up temporary files
        for temp_file in [temp_pdf_path, temp_txt_path]:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.unlink(temp_file)
                except Exception:
                    app.logger.warning(f"Failed to delete temporary file: {temp_file}")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)