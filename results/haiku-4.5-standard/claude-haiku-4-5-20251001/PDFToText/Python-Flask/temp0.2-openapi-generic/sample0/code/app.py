import os
import subprocess
import tempfile
from flask import Flask, request, Response
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
ALLOWED_EXTENSIONS = {'pdf'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

def allowed_file(filename):
    """Check if the file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using pdftotext utility."""
    try:
        result = subprocess.run(
            ['pdftotext', pdf_path, '-'],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            raise Exception(f"pdftotext failed: {result.stderr}")
        
        return result.stdout
    except subprocess.TimeoutExpired:
        raise Exception("PDF conversion timed out")
    except FileNotFoundError:
        raise Exception("pdftotext utility not found")
    except Exception as e:
        raise Exception(f"Error extracting text: {str(e)}")

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
        
        # Check if file is selected
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
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return Response(
                '{"error": "File size exceeds maximum allowed size"}',
                status=400,
                mimetype='application/json'
            )
        
        if file_size == 0:
            return Response(
                '{"error": "File is empty"}',
                status=400,
                mimetype='application/json'
            )
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            tmp_path = tmp_file.name
            file.save(tmp_path)
        
        try:
            # Extract text from PDF
            text_content = extract_text_from_pdf(tmp_path)
            
            # Return text content
            return Response(
                text_content,
                status=200,
                mimetype='text/plain'
            )
        
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    
    except Exception as e:
        return Response(
            f'{{"error": "Internal server error: {str(e)}"}}',
            status=500,
            mimetype='application/json'
        )

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error."""
    return Response(
        '{"error": "File size exceeds maximum allowed size"}',
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
    """Handle 405 errors."""
    return Response(
        '{"error": "Method not allowed"}',
        status=405,
        mimetype='application/json'
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)