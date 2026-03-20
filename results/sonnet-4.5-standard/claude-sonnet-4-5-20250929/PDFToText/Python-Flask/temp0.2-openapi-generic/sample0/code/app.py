from flask import Flask, request, jsonify, Response
import subprocess
import tempfile
import os
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    """Check if the file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(pdf_path):
    """
    Extract text from a PDF file using pdftotext utility.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        Extracted text as string
        
    Raises:
        Exception: If extraction fails
    """
    try:
        # Use pdftotext to extract text from PDF
        result = subprocess.run(
            ['pdftotext', '-enc', 'UTF-8', pdf_path, '-'],
            capture_output=True,
            text=True,
            timeout=30,
            check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        raise Exception(f"PDF extraction failed: {e.stderr}")
    except subprocess.TimeoutExpired:
        raise Exception("PDF extraction timed out")
    except Exception as e:
        raise Exception(f"Unexpected error during PDF extraction: {str(e)}")

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    """
    Convert a PDF file to text.
    
    Expects a multipart/form-data request with a 'file' field containing the PDF.
    Returns the extracted text as plain text.
    """
    # Check if file is present in request
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    # Check if a file was actually selected
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
        return jsonify({'error': 'File size exceeds maximum allowed size'}), 400
    
    if file_size == 0:
        return jsonify({'error': 'Empty file provided'}), 400
    
    # Create a temporary file to store the uploaded PDF
    temp_fd = None
    temp_path = None
    
    try:
        # Create temporary file with secure permissions
        temp_fd, temp_path = tempfile.mkstemp(suffix='.pdf', prefix='pdf_convert_')
        
        # Save uploaded file to temporary location
        with os.fdopen(temp_fd, 'wb') as temp_file:
            temp_fd = None  # Prevent double close
            file.save(temp_file)
        
        # Extract text from PDF
        text_content = extract_text_from_pdf(temp_path)
        
        # Return the extracted text as plain text
        return Response(text_content, mimetype='text/plain', status=200)
        
    except Exception as e:
        # Log error and return 500
        app.logger.error(f"Error converting PDF: {str(e)}")
        return jsonify({'error': 'Conversion failed'}), 500
        
    finally:
        # Clean up temporary file
        if temp_fd is not None:
            try:
                os.close(temp_fd)
            except:
                pass
        
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error."""
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    """Handle internal server errors."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)