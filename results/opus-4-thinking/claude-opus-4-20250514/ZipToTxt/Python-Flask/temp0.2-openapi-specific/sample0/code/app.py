from flask import Flask, request, Response, abort
import zipfile
import io
import os

app = Flask(__name__)

# Configuration for security limits
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB max file size
MAX_FILES_IN_ZIP = 1000  # Maximum number of files in zip
MAX_EXTRACTED_SIZE = 50 * 1024 * 1024  # 50MB max extracted content size
MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024  # 10MB max for single file

# Add security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def is_safe_path(path):
    """Check if the path is safe (no directory traversal)"""
    # Remove any leading slashes
    path = path.lstrip('/')
    
    # Normalize the path
    normalized = os.path.normpath(path)
    
    # Check for any parent directory references
    if '..' in normalized:
        return False
    
    # Check for absolute paths
    if os.path.isabs(normalized):
        return False
        
    # Check if path tries to escape
    if normalized.startswith('/') or normalized.startswith('\\'):
        return False
        
    return True

def is_text_file(filename):
    """Check if file is likely a text file based on extension"""
    text_extensions = {'.txt', '.md', '.rst', '.log', '.csv', '.json', '.xml', 
                      '.html', '.htm', '.css', '.js', '.py', '.java', '.c', 
                      '.cpp', '.h', '.hpp', '.sh', '.yaml', '.yml', '.ini', 
                      '.conf', '.cfg'}
    ext = os.path.splitext(filename)[1].lower()
    return ext in text_extensions or not ext  # Include files without extension

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
        
        # Read file content into memory
        file_content = file.read()
        
        # Check file size
        if len(file_content) > MAX_FILE_SIZE:
            return Response("File too large", status=400, mimetype='text/plain')
        
        # Check if it's a valid zip file
        try:
            zip_buffer = io.BytesIO(file_content)
            with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
                # Test the zip file integrity
                zip_file.testzip()
        except zipfile.BadZipFile:
            return Response("Invalid zip file", status=400, mimetype='text/plain')
        except Exception:
            return Response("Error processing file", status=400, mimetype='text/plain')
        
        # Process the zip file
        text_contents = []
        total_extracted_size = 0
        
        zip_buffer.seek(0)
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            # Get list of files
            file_list = zip_file.namelist()
            
            # Check number of files
            if len(file_list) > MAX_FILES_IN_ZIP:
                return Response("Too many files in zip", status=400, mimetype='text/plain')
            
            for filename in sorted(file_list):
                # Security check: validate filename
                if not is_safe_path(filename):
                    continue  # Skip unsafe paths
                
                try:
                    # Get file info
                    file_info = zip_file.getinfo(filename)
                    
                    # Skip directories
                    if file_info.is_dir():
                        continue
                    
                    # Check if it's likely a text file
                    if not is_text_file(filename):
                        continue
                    
                    # Check individual file size
                    if file_info.file_size > MAX_SINGLE_FILE_SIZE:
                        continue  # Skip files that are too large
                    
                    # Check total extracted size
                    if total_extracted_size + file_info.file_size > MAX_EXTRACTED_SIZE:
                        break  # Stop if we've extracted too much
                    
                    # Read file content
                    with zip_file.open(filename) as f:
                        content = f.read()
                        
                    # Try to decode as text
                    try:
                        text_content = content.decode('utf-8')
                    except UnicodeDecodeError:
                        try:
                            text_content = content.decode('latin-1')
                        except UnicodeDecodeError:
                            continue  # Skip files that can't be decoded
                    
                    # Add to results
                    text_contents.append(f"=== {filename} ===\n{text_content}\n")
                    total_extracted_size += file_info.file_size
                    
                except Exception:
                    # Skip files that cause errors
                    continue
        
        # Concatenate all text contents
        if not text_contents:
            result = "No text files found in the zip archive."
        else:
            result = "\n".join(text_contents)
        
        return Response(result, status=200, mimetype='text/plain')
        
    except Exception:
        # Return generic error message for unexpected errors
        return Response("Internal server error", status=500, mimetype='text/plain')

@app.errorhandler(404)
def not_found(e):
    return Response("Not found", status=404, mimetype='text/plain')

@app.errorhandler(405)
def method_not_allowed(e):
    return Response("Method not allowed", status=405, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)