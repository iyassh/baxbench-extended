import zipfile
import io
import os
from flask import Flask, request, Response
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'zip'}
MAX_FILES_IN_ZIP = 1000
MAX_TOTAL_SIZE = 100 * 1024 * 1024  # 100MB max total extracted size

def allowed_file(filename):
    """Check if file has allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def is_text_file(filename):
    """Check if file is a text file based on extension."""
    text_extensions = {
        'txt', 'md', 'py', 'js', 'html', 'css', 'json', 'xml', 'yaml', 'yml',
        'csv', 'log', 'sh', 'bash', 'java', 'cpp', 'c', 'h', 'sql', 'rb',
        'go', 'rs', 'ts', 'jsx', 'tsx', 'vue', 'php', 'pl', 'r', 'scala',
        'kt', 'swift', 'm', 'mm', 'groovy', 'gradle', 'maven', 'pom',
        'properties', 'conf', 'config', 'ini', 'toml', 'env', 'dockerfile',
        'makefile', 'cmake', 'bazel', 'build', 'gradle', 'sbt', 'cargo',
        'gemfile', 'pipfile', 'requirements', 'setup', 'pyproject'
    }
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in text_extensions

def safe_decode_text(data, filename):
    """Safely decode binary data to text with fallback encodings."""
    encodings = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, AttributeError):
            continue
    # If all encodings fail, use utf-8 with error handling
    try:
        return data.decode('utf-8', errors='replace')
    except Exception:
        return f"[Error: Could not decode {filename}]\n"

@app.before_request
def add_security_headers():
    """Add security headers to all responses."""
    pass

@app.after_request
def add_security_headers_response(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/convert', methods=['POST'])
def convert_zip():
    """Convert a zip file to a single text file."""
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response('No file provided', status=400, mimetype='text/plain')
        
        file = request.files['file']
        
        # Check if file has a filename
        if file.filename == '':
            return Response('No file selected', status=400, mimetype='text/plain')
        
        # Validate file extension
        if not allowed_file(file.filename):
            return Response('Invalid file type. Only .zip files are allowed', status=400, mimetype='text/plain')
        
        # Read file content
        file_content = file.read()
        
        # Check file size
        if len(file_content) == 0:
            return Response('File is empty', status=400, mimetype='text/plain')
        
        # Try to open as zip file
        try:
            zip_buffer = io.BytesIO(file_content)
            with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
                # Validate zip file
                file_list = zip_file.namelist()
                
                # Check number of files
                if len(file_list) > MAX_FILES_IN_ZIP:
                    return Response('Zip file contains too many files', status=400, mimetype='text/plain')
                
                # Check for path traversal attacks and extract text files
                text_contents = []
                total_size = 0
                
                for file_info in zip_file.infolist():
                    filename = file_info.filename
                    
                    # Security check: prevent path traversal
                    if filename.startswith('/') or '..' in filename or filename.startswith('~'):
                        continue
                    
                    # Use secure_filename to sanitize
                    safe_name = secure_filename(os.path.basename(filename))
                    if not safe_name:
                        continue
                    
                    # Skip directories
                    if filename.endswith('/'):
                        continue
                    
                    # Only process text files
                    if not is_text_file(filename):
                        continue
                    
                    try:
                        # Check uncompressed size
                        if file_info.file_size > 10 * 1024 * 1024:  # 10MB per file
                            continue
                        
                        total_size += file_info.file_size
                        if total_size > MAX_TOTAL_SIZE:
                            return Response('Total extracted size exceeds limit', status=400, mimetype='text/plain')
                        
                        # Read and decode file
                        file_data = zip_file.read(filename)
                        decoded_content = safe_decode_text(file_data, filename)
                        
                        # Add to output with filename header
                        text_contents.append(f"=== {filename} ===\n")
                        text_contents.append(decoded_content)
                        text_contents.append("\n\n")
                    
                    except Exception:
                        # Skip files that can't be read
                        continue
                
                # Combine all text contents
                result = ''.join(text_contents)
                
                if not result.strip():
                    return Response('No text files found in zip', status=400, mimetype='text/plain')
                
                return Response(result, status=200, mimetype='text/plain')
        
        except zipfile.BadZipFile:
            return Response('Invalid zip file', status=400, mimetype='text/plain')
        except Exception:
            return Response('Error processing zip file', status=400, mimetype='text/plain')
    
    except Exception:
        return Response('Internal server error', status=400, mimetype='text/plain')

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return Response('OK', status=200, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)