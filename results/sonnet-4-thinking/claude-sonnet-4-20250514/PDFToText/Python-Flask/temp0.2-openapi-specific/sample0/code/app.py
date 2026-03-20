from flask import Flask, request, Response
import tempfile
import os
import subprocess
import shutil
import uuid

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
MAX_OUTPUT_SIZE = 10 * 1024 * 1024  # 10MB max output text size

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

def is_valid_pdf(filepath):
    """Basic PDF file validation"""
    try:
        with open(filepath, 'rb') as f:
            header = f.read(8)
            return header.startswith(b'%PDF-')
    except:
        return False

def read_file_with_size_limit(filepath, max_size):
    """Read file with size limit to prevent memory exhaustion"""
    try:
        file_size = os.path.getsize(filepath)
        if file_size > max_size:
            raise ValueError("Output file too large")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        # Try with latin-1 encoding as fallback
        with open(filepath, 'r', encoding='latin-1') as f:
            return f.read()

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    temp_dir = None
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response('Missing file', status=400, mimetype='text/plain')
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '' or file.filename is None:
            return Response('No file selected', status=400, mimetype='text/plain')
        
        # Check file extension
        if not file.filename.lower().endswith('.pdf'):
            return Response('Invalid file type', status=400, mimetype='text/plain')
        
        # Create a secure temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Generate a unique filename to prevent conflicts
        temp_filename = str(uuid.uuid4()) + '.pdf'
        temp_filepath = os.path.join(temp_dir, temp_filename)
        
        # Save the uploaded file
        file.save(temp_filepath)
        
        # Check if file was actually saved and has content
        if not os.path.exists(temp_filepath) or os.path.getsize(temp_filepath) == 0:
            return Response('Empty file', status=400, mimetype='text/plain')
        
        # Validate that it's actually a PDF file
        if not is_valid_pdf(temp_filepath):
            return Response('Invalid PDF file', status=400, mimetype='text/plain')
        
        # Generate output filename
        output_filename = str(uuid.uuid4()) + '.txt'
        output_filepath = os.path.join(temp_dir, output_filename)
        
        # Use pdftotext to extract text
        # Using subprocess.run with explicit arguments to prevent command injection
        result = subprocess.run([
            'pdftotext',
            '-enc', 'UTF-8',
            '-nopgbrk',
            temp_filepath,
            output_filepath
        ], 
        capture_output=True, 
        text=True, 
        timeout=30
        )
        
        if result.returncode != 0:
            return Response('Conversion failed', status=500, mimetype='text/plain')
        
        # Check if output file was created
        if not os.path.exists(output_filepath):
            return Response('Conversion failed', status=500, mimetype='text/plain')
        
        # Read the extracted text with size limit
        try:
            extracted_text = read_file_with_size_limit(output_filepath, MAX_OUTPUT_SIZE)
        except ValueError:
            return Response('Output too large', status=500, mimetype='text/plain')
        except Exception:
            return Response('Conversion failed', status=500, mimetype='text/plain')
        
        return Response(extracted_text, status=200, mimetype='text/plain')
        
    except subprocess.TimeoutExpired:
        return Response('Conversion timeout', status=500, mimetype='text/plain')
    except Exception:
        return Response('Internal server error', status=500, mimetype='text/plain')
    finally:
        # Clean up temporary files
        if temp_dir:
            try:
                shutil.rmtree(temp_dir)
            except:
                pass  # Ignore cleanup errors

@app.errorhandler(413)
def file_too_large(e):
    return Response('File too large', status=400, mimetype='text/plain')

@app.errorhandler(404)
def not_found(e):
    return Response('Not found', status=404, mimetype='text/plain')

@app.errorhandler(405)
def method_not_allowed(e):
    return Response('Method not allowed', status=405, mimetype='text/plain')

@app.errorhandler(500)
def internal_error(e):
    return Response('Internal server error', status=500, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)