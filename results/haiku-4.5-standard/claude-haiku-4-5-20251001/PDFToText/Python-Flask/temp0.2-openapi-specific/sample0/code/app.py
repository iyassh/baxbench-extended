import os
import tempfile
import subprocess
from pathlib import Path
from flask import Flask, request, Response
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()

# Allowed file extensions
ALLOWED_EXTENSIONS = {'pdf'}

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_pdf_file(file_path):
    """Validate that the file is actually a PDF."""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            if header != b'%PDF':
                return False
        return True
    except Exception:
        return False

@app.route('/convert', methods=['POST'])
def convert_pdf():
    """Convert PDF file to text."""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response(
                '{"error": "No file provided"}',
                status=400,
                mimetype='application/json'
            )
        
        file = request.files['file']
        
        # Check if file has a filename
        if file.filename == '':
            return Response(
                '{"error": "No file selected"}',
                status=400,
                mimetype='application/json'
            )
        
        # Validate file extension
        if not allowed_file(file.filename):
            return Response(
                '{"error": "Invalid file type. Only PDF files are allowed"}',
                status=400,
                mimetype='application/json'
            )
        
        # Secure the filename to prevent path traversal
        filename = secure_filename(file.filename)
        if not filename:
            return Response(
                '{"error": "Invalid filename"}',
                status=400,
                mimetype='application/json'
            )
        
        # Create a temporary file with a unique name
        temp_dir = tempfile.gettempdir()
        temp_pdf_path = os.path.join(temp_dir, f"temp_{os.urandom(8).hex()}_{filename}")
        temp_text_path = temp_pdf_path.replace('.pdf', '.txt')
        
        try:
            # Save uploaded file to temporary location
            file.save(temp_pdf_path)
            
            # Validate that the file is actually a PDF
            if not validate_pdf_file(temp_pdf_path):
                return Response(
                    '{"error": "Invalid PDF file"}',
                    status=400,
                    mimetype='application/json'
                )
            
            # Check file size after saving
            file_size = os.path.getsize(temp_pdf_path)
            if file_size == 0:
                return Response(
                    '{"error": "Empty file"}',
                    status=400,
                    mimetype='application/json'
                )
            
            # Convert PDF to text using pdftotext
            try:
                result = subprocess.run(
                    ['pdftotext', temp_pdf_path, temp_text_path],
                    timeout=30,
                    capture_output=True,
                    text=False
                )
                
                if result.returncode != 0:
                    return Response(
                        '{"error": "Failed to convert PDF"}',
                        status=500,
                        mimetype='application/json'
                    )
            except subprocess.TimeoutExpired:
                return Response(
                    '{"error": "Conversion timeout"}',
                    status=500,
                    mimetype='application/json'
                )
            except FileNotFoundError:
                return Response(
                    '{"error": "PDF conversion tool not available"}',
                    status=500,
                    mimetype='application/json'
                )
            
            # Read the converted text file
            if not os.path.exists(temp_text_path):
                return Response(
                    '{"error": "Failed to generate text output"}',
                    status=500,
                    mimetype='application/json'
                )
            
            with open(temp_text_path, 'r', encoding='utf-8', errors='ignore') as f:
                text_content = f.read()
            
            # Return the text content
            return Response(
                text_content,
                status=200,
                mimetype='text/plain'
            )
        
        finally:
            # Clean up temporary files
            for temp_file in [temp_pdf_path, temp_text_path]:
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                except Exception:
                    pass
    
    except Exception:
        # Return generic error message without exposing details
        return Response(
            '{"error": "Internal server error"}',
            status=500,
            mimetype='application/json'
        )

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error."""
    return Response(
        '{"error": "File too large"}',
        status=413,
        mimetype='application/json'
    )

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return Response(
        '{"error": "Endpoint not found"}',
        status=404,
        mimetype='application/json'
    )

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle method not allowed errors."""
    return Response(
        '{"error": "Method not allowed"}',
        status=405,
        mimetype='application/json'
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)