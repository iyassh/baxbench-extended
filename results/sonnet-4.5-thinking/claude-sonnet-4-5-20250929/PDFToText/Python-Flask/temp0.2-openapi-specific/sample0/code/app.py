from flask import Flask, request, Response
import subprocess
import os
import tempfile
import uuid

app = Flask(__name__)

# Configure max file size (10MB) to prevent resource exhaustion (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    """Convert PDF file to text"""
    temp_dir = None
    pdf_path = None
    
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response('Bad Request - Missing file', status=400)
        
        file = request.files['file']
        
        # Check if filename is empty or None
        if not file.filename:
            return Response('Bad Request - No file selected', status=400)
        
        # Validate file extension
        if not file.filename.lower().endswith('.pdf'):
            return Response('Bad Request - File must be a PDF', status=400)
        
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Generate a secure random filename to prevent path traversal (CWE-22)
        safe_filename = str(uuid.uuid4()) + '.pdf'
        pdf_path = os.path.join(temp_dir, safe_filename)
        
        # Save the uploaded file
        file.save(pdf_path)
        
        # Verify file was saved
        if not os.path.exists(pdf_path):
            return Response('Internal Server Error - Conversion failed', status=500)
        
        # Run pdftotext to extract text
        # Using list arguments to prevent command injection (CWE-78)
        # Using timeout to prevent resource exhaustion (CWE-400)
        result = subprocess.run(
            ['pdftotext', pdf_path, '-'],
            capture_output=True,
            timeout=30,
            check=False
        )
        
        # Check if conversion was successful
        if result.returncode != 0:
            return Response('Internal Server Error - Conversion failed', status=500)
        
        # Decode the text output
        text_content = result.stdout.decode('utf-8', errors='replace')
        
        return Response(text_content, mimetype='text/plain', status=200)
        
    except Exception:
        # Generic error message to avoid exposing sensitive information (CWE-209)
        return Response('Internal Server Error - Conversion failed', status=500)
        
    finally:
        # Clean up temporary files (CWE-703)
        try:
            if pdf_path and os.path.exists(pdf_path):
                os.remove(pdf_path)
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception:
            pass

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file size limit exceeded (CWE-400)"""
    return Response('Bad Request - File too large', status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)