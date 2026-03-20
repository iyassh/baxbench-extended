import os
import zipfile
import tempfile
from flask import Flask, request, Response, abort
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size (CWE-400)
app.config['UPLOAD_EXTENSIONS'] = ['.zip']

# Text file extensions to extract
TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.log', '.json', '.xml', '.html', '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'}

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

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic exception handler (CWE-703, CWE-209)"""
    app.logger.error(f"Unhandled exception: {type(e).__name__}")
    return Response("An error occurred", status=500, mimetype='text/plain')

def is_safe_path(basedir, path):
    """Check if path is safe and within basedir (CWE-22)"""
    # Resolve the absolute path
    matchpath = os.path.abspath(path)
    # Ensure the path is within basedir
    return matchpath.startswith(basedir)

def is_text_file(filename):
    """Check if file has a text extension"""
    return any(filename.lower().endswith(ext) for ext in TEXT_EXTENSIONS)

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            abort(400)
        
        file = request.files['file']
        
        # Check if file was selected
        if file.filename == '':
            abort(400)
        
        # Secure the filename
        filename = secure_filename(file.filename)
        
        # Check file extension
        if not filename.lower().endswith('.zip'):
            abort(400)
        
        # Create a temporary directory for extraction
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded file
            temp_zip_path = os.path.join(temp_dir, filename)
            file.save(temp_zip_path)
            
            # Verify it's a valid zip file
            try:
                with zipfile.ZipFile(temp_zip_path, 'r') as zip_file:
                    # Check for zip bombs (CWE-400)
                    total_size = sum(zinfo.file_size for zinfo in zip_file.filelist)
                    if total_size > 500 * 1024 * 1024:  # 500MB uncompressed limit
                        abort(400)
                    
                    # Extract and concatenate text files
                    output_text = io.StringIO()
                    
                    for zip_info in zip_file.filelist:
                        # Skip directories
                        if zip_info.is_dir():
                            continue
                        
                        # Sanitize filename (CWE-22)
                        member_path = os.path.join(temp_dir, zip_info.filename)
                        if not is_safe_path(temp_dir, member_path):
                            continue
                        
                        # Check if it's a text file
                        if is_text_file(zip_info.filename):
                            try:
                                # Read file content
                                with zip_file.open(zip_info) as f:
                                    # Try to decode as text
                                    content = f.read()
                                    try:
                                        text_content = content.decode('utf-8')
                                    except UnicodeDecodeError:
                                        try:
                                            text_content = content.decode('latin-1')
                                        except UnicodeDecodeError:
                                            # Skip files that can't be decoded
                                            continue
                                    
                                    # Add filename header
                                    output_text.write(f"\n--- {zip_info.filename} ---\n")
                                    output_text.write(text_content)
                                    output_text.write("\n")
                            except Exception:
                                # Skip files that cause errors (CWE-703)
                                continue
                    
                    # Get the final text
                    result_text = output_text.getvalue()
                    output_text.close()
                    
                    # Return the concatenated text
                    return Response(result_text, mimetype='text/plain', status=200)
                    
            except zipfile.BadZipFile:
                abort(400)
            except Exception:
                # Handle other zip-related errors (CWE-703)
                abort(400)
                
    except Exception:
        # Catch any unexpected errors (CWE-703)
        abort(400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)