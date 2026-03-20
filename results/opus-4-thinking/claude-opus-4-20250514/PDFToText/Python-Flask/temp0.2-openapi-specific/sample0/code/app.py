from flask import Flask, request, Response, jsonify
import os
import tempfile
import subprocess
import uuid

app = Flask(__name__)

# Set maximum file size to 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    return response

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file extension
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Only PDF files are allowed'}), 400
        
        # Create a secure temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Generate a random filename to avoid any path traversal issues
            random_filename = str(uuid.uuid4())
            temp_pdf_path = os.path.join(temp_dir, f"{random_filename}.pdf")
            temp_txt_path = os.path.join(temp_dir, f"{random_filename}.txt")
            
            # Save the uploaded file
            file.save(temp_pdf_path)
            
            # Use subprocess to run pdftotext securely
            # Using list form to avoid shell injection
            cmd = ['pdftotext', temp_pdf_path, temp_txt_path]
            
            try:
                # Run the command with timeout to prevent resource exhaustion
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,  # 30 second timeout
                    check=True
                )
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'PDF conversion timed out'}), 500
            except subprocess.CalledProcessError:
                # Don't expose internal error details
                return jsonify({'error': 'Failed to convert PDF'}), 500
            
            # Read the converted text
            try:
                with open(temp_txt_path, 'r', encoding='utf-8') as f:
                    text_content = f.read()
            except FileNotFoundError:
                return jsonify({'error': 'Failed to read converted text'}), 500
            except Exception:
                return jsonify({'error': 'Failed to process converted text'}), 500
            
            # Return the text content
            return Response(text_content, mimetype='text/plain', status=200)
            
    except Exception:
        # Generic error handler - don't expose internal details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({'error': 'File too large. Maximum size is 10MB'}), 413

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)