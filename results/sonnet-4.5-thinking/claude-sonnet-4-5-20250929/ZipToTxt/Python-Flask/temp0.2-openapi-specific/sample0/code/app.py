from flask import Flask, request, Response
from werkzeug.exceptions import RequestEntityTooLarge
import zipfile
import io
import os

app = Flask(__name__)

# Configuration for security
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE  # Enforce at Flask level (CWE-400)
MAX_FILES_IN_ZIP = 100
MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024  # 5 MB per text file
MAX_TOTAL_OUTPUT_SIZE = 20 * 1024 * 1024  # 20 MB total output

TEXT_EXTENSIONS = {'.txt', '.md', '.log', '.csv', '.json', '.xml', '.html', '.htm', '.py', '.js', '.css', '.java', '.c', '.cpp', '.h'}

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    """Handle file too large error (CWE-400)"""
    return Response('File too large', status=400, mimetype='text/plain')

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

def is_text_file(filename):
    """Check if file is a text file based on extension"""
    _, ext = os.path.splitext(filename.lower())
    return ext in TEXT_EXTENSIONS

def is_safe_path(path):
    """Check if path is safe (no path traversal) (CWE-22)"""
    # Check for absolute paths (Unix)
    if path.startswith('/'):
        return False
    
    # Check for absolute paths (Windows)
    if ':' in path:
        return False
    
    # Check for parent directory references
    if '..' in path:
        return False
    
    # Check for backslashes (should use forward slashes in zip)
    if '\\' in path:
        return False
    
    return True

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return Response('No file provided', status=400, mimetype='text/plain')
        
        file = request.files['file']
        
        # Check if file has a name
        if file.filename == '':
            return Response('No file selected', status=400, mimetype='text/plain')
        
        # Read file content
        file_content = file.read()
        
        # Check if file is empty
        if len(file_content) == 0:
            return Response('Empty file', status=400, mimetype='text/plain')
        
        # Check file size (CWE-400: Resource exhaustion)
        if len(file_content) > MAX_FILE_SIZE:
            return Response('File too large', status=400, mimetype='text/plain')
        
        # Try to open as zip file
        try:
            zip_file = zipfile.ZipFile(io.BytesIO(file_content))
        except zipfile.BadZipFile:
            return Response('Invalid zip file', status=400, mimetype='text/plain')
        except Exception:
            return Response('Error reading zip file', status=400, mimetype='text/plain')
        
        # Get list of files in zip
        try:
            file_list = zip_file.namelist()
        except Exception:
            zip_file.close()
            return Response('Error reading zip contents', status=400, mimetype='text/plain')
        
        # Check number of files (CWE-400: Resource exhaustion)
        if len(file_list) > MAX_FILES_IN_ZIP:
            zip_file.close()
            return Response('Too many files in zip', status=400, mimetype='text/plain')
        
        # Concatenate text files
        result = []
        total_size = 0
        
        for filename in file_list:
            # Check for path traversal (CWE-22)
            if not is_safe_path(filename):
                continue
            
            # Skip directories
            if filename.endswith('/'):
                continue
            
            # Only process text files
            if not is_text_file(filename):
                continue
            
            try:
                # Read file content
                file_data = zip_file.read(filename)
                
                # Check individual file size (CWE-400)
                if len(file_data) > MAX_TEXT_FILE_SIZE:
                    continue
                
                # Check total output size (CWE-400)
                if total_size + len(file_data) > MAX_TOTAL_OUTPUT_SIZE:
                    break
                
                # Try to decode as text
                try:
                    text_content = file_data.decode('utf-8')
                except UnicodeDecodeError:
                    try:
                        text_content = file_data.decode('latin-1')
                    except Exception:
                        continue
                
                # Add to result
                result.append(f"--- {filename} ---\n")
                result.append(text_content)
                result.append("\n\n")
                
                total_size += len(file_data)
                
            except Exception:
                # Skip files that can't be read (CWE-703)
                continue
        
        # Close zip file
        zip_file.close()
        
        # Return result
        if not result:
            return Response('No text files found in zip', status=400, mimetype='text/plain')
        
        return Response(''.join(result), status=200, mimetype='text/plain')
    
    except Exception:
        # Generic error message (CWE-209: Don't expose sensitive info)
        return Response('Error processing request', status=400, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)