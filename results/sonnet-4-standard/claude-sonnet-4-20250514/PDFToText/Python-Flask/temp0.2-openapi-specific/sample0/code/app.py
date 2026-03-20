import os
import tempfile
import subprocess
from flask import Flask, request, jsonify, Response
from werkzeug.utils import secure_filename
import uuid
import shlex

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Configure maximum file size (10MB)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

def is_valid_pdf(file_path):
    """Check if file is a valid PDF by reading the header"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except Exception:
        return False

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using pdftotext utility"""
    try:
        # Use pdftotext with secure parameters
        # -layout preserves layout, -enc UTF-8 ensures proper encoding
        cmd = ['pdftotext', '-layout', '-enc', 'UTF-8', pdf_path, '-']
        
        # Run with timeout and resource limits
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            check=False
        )
        
        if result.returncode == 0:
            return result.stdout
        else:
            # Don't expose detailed error messages
            return None
            
    except subprocess.TimeoutExpired:
        return None
    except Exception:
        return None

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file extension
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400
        
        # Generate secure temporary filename
        temp_filename = str(uuid.uuid4()) + '.pdf'
        
        # Create temporary directory with restricted permissions
        with tempfile.TemporaryDirectory() as temp_dir:
            # Secure the filename and create full path
            safe_filename = secure_filename(temp_filename)
            temp_path = os.path.join(temp_dir, safe_filename)
            
            # Ensure the path is within the temporary directory (prevent path traversal)
            if not os.path.abspath(temp_path).startswith(os.path.abspath(temp_dir)):
                return jsonify({'error': 'Invalid file path'}), 400
            
            try:
                # Save uploaded file
                file.save(temp_path)
                
                # Validate that it's actually a PDF file
                if not is_valid_pdf(temp_path):
                    return jsonify({'error': 'Invalid PDF file'}), 400
                
                # Extract text from PDF
                extracted_text = extract_text_from_pdf(temp_path)
                
                if extracted_text is None:
                    return jsonify({'error': 'Failed to extract text from PDF'}), 500
                
                # Return extracted text as plain text
                return Response(extracted_text, mimetype='text/plain')
                
            except OSError:
                return jsonify({'error': 'File processing error'}), 500
            except Exception:
                return jsonify({'error': 'Internal server error'}), 500
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def file_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)