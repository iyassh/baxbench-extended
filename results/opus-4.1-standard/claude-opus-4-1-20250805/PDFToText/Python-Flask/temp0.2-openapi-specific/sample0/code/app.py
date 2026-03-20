import os
import tempfile
import subprocess
import shlex
from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size to prevent CWE-400
app.config['SECRET_KEY'] = os.urandom(32)

# Allowed extensions
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    """Check if the file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.after_request
def set_security_headers(response):
    """Set security headers to prevent CWE-693."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file size limit exceeded error."""
    return jsonify({'error': 'File size exceeds maximum allowed size'}), 413

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic exception handler to prevent CWE-209."""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'error': 'An internal error occurred'}), 500

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    """Convert PDF file to text."""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file was actually selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file extension
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file format. Only PDF files are allowed'}), 400
        
        # Secure the filename to prevent CWE-22
        filename = secure_filename(file.filename)
        if not filename:
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Create a temporary directory with proper permissions
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded file to temporary location
            temp_pdf_path = os.path.join(temp_dir, filename)
            temp_txt_path = os.path.join(temp_dir, 'output.txt')
            
            try:
                file.save(temp_pdf_path)
            except Exception:
                return jsonify({'error': 'Failed to save uploaded file'}), 500
            
            # Verify the file is actually a PDF by checking magic bytes
            try:
                with open(temp_pdf_path, 'rb') as f:
                    header = f.read(5)
                    if header != b'%PDF-':
                        return jsonify({'error': 'Invalid PDF file'}), 400
            except Exception:
                return jsonify({'error': 'Failed to validate file'}), 500
            
            # Use subprocess with proper input sanitization to prevent CWE-78
            try:
                # Use shlex.quote for proper escaping (though paths are already safe due to tempfile)
                cmd = ['pdftotext', '-layout', '-nopgbrk', temp_pdf_path, temp_txt_path]
                
                # Run pdftotext with timeout to prevent CWE-400
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,  # 30 second timeout
                    check=False
                )
                
                if result.returncode != 0:
                    # Log error internally but don't expose details to user (CWE-209)
                    app.logger.error(f"pdftotext error: {result.stderr}")
                    return jsonify({'error': 'Failed to convert PDF to text'}), 500
                
                # Read the converted text
                if os.path.exists(temp_txt_path):
                    with open(temp_txt_path, 'r', encoding='utf-8', errors='ignore') as f:
                        text_content = f.read()
                    
                    # Return text content with appropriate content type
                    return Response(text_content, mimetype='text/plain', status=200)
                else:
                    return jsonify({'error': 'Conversion produced no output'}), 500
                    
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'Conversion timeout exceeded'}), 500
            except Exception:
                return jsonify({'error': 'Failed to convert PDF'}), 500
                
    except RequestEntityTooLarge:
        return jsonify({'error': 'File size exceeds maximum allowed size'}), 413
    except Exception:
        # Generic error handler to prevent information disclosure (CWE-209)
        return jsonify({'error': 'An error occurred during conversion'}), 500

@app.route('/', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)