import os
import zipfile
import tempfile
import io
from flask import Flask, request, Response, abort
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size (CWE-400)
app.config['SECRET_KEY'] = os.urandom(32)

# Allowed text file extensions
ALLOWED_TEXT_EXTENSIONS = {'.txt', '.md', '.log', '.csv', '.json', '.xml', '.html', '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'}

def is_safe_path(basedir, path):
    """Check if the path is safe and doesn't escape the base directory (CWE-22)"""
    # Resolve the absolute path
    matchpath = os.path.abspath(os.path.join(basedir, path))
    basedir = os.path.abspath(basedir)
    # Ensure the path is within the base directory
    return matchpath.startswith(basedir)

def is_text_file(filename):
    """Check if a file is likely a text file based on extension"""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_TEXT_EXTENSIONS

@app.after_request
def set_security_headers(response):
    """Set security headers (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(400)
def bad_request(e):
    """Handle 400 errors without exposing sensitive information (CWE-209)"""
    return Response("Invalid input", status=400, mimetype='text/plain')

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors without exposing sensitive information (CWE-209)"""
    return Response("Internal server error", status=500, mimetype='text/plain')

@app.route('/convert', methods=['POST'])
def convert():
    """Convert a zip file to a text file"""
    temp_dir = None
    
    try:
        # Check if file is present in request (CWE-703)
        if 'file' not in request.files:
            abort(400)
        
        file = request.files['file']
        
        # Check if file was actually selected (CWE-703)
        if file.filename == '':
            abort(400)
        
        # Secure the filename
        filename = secure_filename(file.filename)
        
        # Check if it's a zip file
        if not filename.lower().endswith('.zip'):
            abort(400)
        
        # Read file content into memory with size limit enforced by MAX_CONTENT_LENGTH
        file_content = file.read()
        
        # Verify it's a valid zip file (CWE-703)
        try:
            with zipfile.ZipFile(io.BytesIO(file_content), 'r') as test_zip:
                # Test the zip file integrity
                test_result = test_zip.testzip()
                if test_result is not None:
                    abort(400)
        except (zipfile.BadZipFile, zipfile.LargeZipFile):
            abort(400)
        
        # Create a temporary directory for extraction
        temp_dir = tempfile.mkdtemp()
        
        # Process the zip file
        output_text = []
        total_size = 0
        max_total_size = 50 * 1024 * 1024  # 50MB max total extracted size (CWE-400)
        max_file_count = 1000  # Maximum number of files to process (CWE-400)
        file_count = 0
        
        try:
            with zipfile.ZipFile(io.BytesIO(file_content), 'r') as zip_file:
                # Get list of files in the zip
                file_list = zip_file.namelist()
                
                # Check file count limit (CWE-400)
                if len(file_list) > max_file_count:
                    abort(400)
                
                for file_info in zip_file.infolist():
                    # Skip directories
                    if file_info.is_dir():
                        continue
                    
                    # Check for path traversal (CWE-22)
                    if not is_safe_path(temp_dir, file_info.filename):
                        continue
                    
                    # Check if it's a text file
                    if not is_text_file(file_info.filename):
                        continue
                    
                    # Check individual file size (CWE-400)
                    if file_info.file_size > 10 * 1024 * 1024:  # 10MB per file
                        continue
                    
                    # Check cumulative size (CWE-400)
                    total_size += file_info.file_size
                    if total_size > max_total_size:
                        break
                    
                    # Increment file count
                    file_count += 1
                    if file_count > max_file_count:
                        break
                    
                    try:
                        # Extract and read the file content
                        with zip_file.open(file_info) as extracted_file:
                            content = extracted_file.read()
                            
                            # Try to decode as text
                            try:
                                text_content = content.decode('utf-8', errors='ignore')
                            except UnicodeDecodeError:
                                # Skip files that can't be decoded as text
                                continue
                            
                            # Add file header and content
                            output_text.append(f"=== {file_info.filename} ===\n")
                            output_text.append(text_content)
                            output_text.append("\n\n")
                    
                    except Exception:
                        # Skip files that cause errors (CWE-703)
                        continue
        
        except Exception:
            # Handle any unexpected errors (CWE-703)
            abort(400)
        
        finally:
            # Clean up temporary directory
            if temp_dir and os.path.exists(temp_dir):
                try:
                    for root, dirs, files in os.walk(temp_dir, topdown=False):
                        for name in files:
                            os.remove(os.path.join(root, name))
                        for name in dirs:
                            os.rmdir(os.path.join(root, name))
                    os.rmdir(temp_dir)
                except Exception:
                    pass  # Ignore cleanup errors
        
        # Join all text content
        final_text = ''.join(output_text)
        
        # Return the concatenated text
        return Response(final_text, status=200, mimetype='text/plain')
    
    except Exception:
        # Catch any unhandled exceptions (CWE-703, CWE-209)
        abort(400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)