import os
import zipfile
import tempfile
from io import BytesIO
from flask import Flask, request, Response, make_response

app = Flask(__name__)

# Configuration for security
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size for CWE-400
app.config['SECRET_KEY'] = os.urandom(32)

# Middleware to add security headers (CWE-693)
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def is_safe_filename(filename):
    """Check if the filename is safe (prevent path traversal - CWE-22)"""
    # Remove any leading slashes or drive letters
    filename = filename.lstrip('/\\')
    
    # Check for path traversal attempts
    if '..' in filename or filename.startswith('/') or ':' in filename:
        return False
        
    # Check for absolute paths on Windows
    if len(filename) > 1 and filename[1] == ':':
        return False
        
    return True

def is_text_file(filename):
    """Check if a file is likely a text file based on extension"""
    text_extensions = ['.txt', '.text', '.md', '.csv', '.log', '.json', '.xml', 
                      '.html', '.htm', '.css', '.js', '.py', '.java', '.c', 
                      '.cpp', '.h', '.hpp', '.sh', '.bat', '.yaml', '.yml', 
                      '.ini', '.conf', '.cfg', '.properties', '.sql', '.r',
                      '.tex', '.rst', '.asciidoc', '.adoc']
    
    # Get the file extension
    _, ext = os.path.splitext(filename.lower())
    return ext in text_extensions

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return Response("No file provided", status=400, mimetype='text/plain')
        
        file = request.files['file']
        
        # Check if file was actually selected
        if file.filename == '':
            return Response("No file selected", status=400, mimetype='text/plain')
        
        # Check if file is a zip file
        if not file.filename.lower().endswith('.zip'):
            return Response("File must be a zip file", status=400, mimetype='text/plain')
        
        # Read file content into memory (with size limit from MAX_CONTENT_LENGTH)
        try:
            file_content = file.read()
        except Exception:
            # Generic error message to avoid information disclosure (CWE-209)
            return Response("Error processing file", status=400, mimetype='text/plain')
        
        try:
            # Open the zip file
            with zipfile.ZipFile(BytesIO(file_content), 'r') as zip_file:
                # Get list of files in the zip
                file_list = zip_file.namelist()
                
                # Limit number of files to prevent resource exhaustion (CWE-400)
                if len(file_list) > 1000:
                    return Response("Too many files in archive", status=400, mimetype='text/plain')
                
                # Collect text content
                text_contents = []
                total_size = 0
                
                for file_name in file_list:
                    # Security check for path traversal (CWE-22)
                    if not is_safe_filename(file_name):
                        continue  # Skip potentially dangerous paths
                    
                    # Skip directories
                    if file_name.endswith('/'):
                        continue
                    
                    # Check if it's likely a text file
                    if not is_text_file(file_name):
                        continue
                    
                    try:
                        # Get file info
                        file_info = zip_file.getinfo(file_name)
                        
                        # Skip files that are too large (CWE-400)
                        if file_info.file_size > 10 * 1024 * 1024:  # 10MB per file
                            continue
                        
                        # Check total size to prevent resource exhaustion
                        total_size += file_info.file_size
                        if total_size > 100 * 1024 * 1024:  # 100MB total
                            return Response("Combined file size too large", status=400, mimetype='text/plain')
                        
                        # Read the file content
                        with zip_file.open(file_name) as f:
                            try:
                                content = f.read()
                                # Try to decode as text
                                text_content = content.decode('utf-8', errors='ignore')
                                
                                # Add file separator and content
                                text_contents.append(f"=== {file_name} ===\n{text_content}\n")
                                
                            except Exception:
                                # Skip files that can't be decoded as text
                                pass
                                
                    except Exception:
                        # Skip files that cause errors (CWE-703)
                        pass
                
                # Concatenate all text contents
                if text_contents:
                    result = "\n".join(text_contents)
                else:
                    result = "No text files found in the archive"
                
                # Return the result
                response = make_response(result)
                response.mimetype = 'text/plain'
                return response
                
        except zipfile.BadZipFile:
            return Response("Invalid zip file", status=400, mimetype='text/plain')
        except Exception:
            # Generic error to avoid information disclosure (CWE-209)
            return Response("Error processing archive", status=400, mimetype='text/plain')
                
    except Exception:
        # Generic error handler (CWE-703, CWE-209)
        return Response("Internal error", status=400, mimetype='text/plain')

@app.errorhandler(413)
def request_entity_too_large(error):
    # Handle file too large error (CWE-400)
    return Response("File too large", status=400, mimetype='text/plain')

@app.errorhandler(404)
def not_found(error):
    return Response("Not found", status=404, mimetype='text/plain')

@app.errorhandler(500)
def internal_error(error):
    # Generic error message (CWE-209)
    return Response("Internal error", status=500, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)