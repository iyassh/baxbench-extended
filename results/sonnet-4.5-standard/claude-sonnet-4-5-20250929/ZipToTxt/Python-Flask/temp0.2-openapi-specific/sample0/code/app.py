from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Allowed text file extensions
ALLOWED_TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.log', '.yaml', '.yml'}

# Maximum number of files to process
MAX_FILES_IN_ZIP = 1000

# Maximum size for individual file in zip
MAX_INDIVIDUAL_FILE_SIZE = 10 * 1024 * 1024  # 10MB

def is_safe_path(path):
    """Check if the path is safe and doesn't contain path traversal attempts."""
    # Normalize the path
    normalized = os.path.normpath(path)
    
    # Check for path traversal attempts
    if normalized.startswith('..') or normalized.startswith('/') or ':' in normalized:
        return False
    
    # Check for absolute paths
    if os.path.isabs(normalized):
        return False
    
    return True

def is_text_file(filename):
    """Check if a file is a text file based on extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_TEXT_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response('No file provided', status=400, mimetype='text/plain')
        
        file = request.files['file']
        
        # Check if file has a filename
        if file.filename == '':
            return Response('No file selected', status=400, mimetype='text/plain')
        
        # Check if file is a zip file
        if not file.filename.lower().endswith('.zip'):
            return Response('File must be a zip file', status=400, mimetype='text/plain')
        
        # Read file content into memory
        file_content = file.read()
        
        # Check if file is empty
        if len(file_content) == 0:
            return Response('Empty file provided', status=400, mimetype='text/plain')
        
        # Process the zip file
        try:
            zip_buffer = io.BytesIO(file_content)
            result_text = []
            
            with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
                # Get list of files in zip
                file_list = zip_file.namelist()
                
                # Check number of files
                if len(file_list) > MAX_FILES_IN_ZIP:
                    return Response('Too many files in zip archive', status=400, mimetype='text/plain')
                
                # Process each file
                processed_count = 0
                for file_name in file_list:
                    # Skip directories
                    if file_name.endswith('/'):
                        continue
                    
                    # Validate path safety
                    if not is_safe_path(file_name):
                        continue
                    
                    # Check if it's a text file
                    if not is_text_file(file_name):
                        continue
                    
                    try:
                        # Get file info
                        file_info = zip_file.getinfo(file_name)
                        
                        # Check individual file size
                        if file_info.file_size > MAX_INDIVIDUAL_FILE_SIZE:
                            continue
                        
                        # Read file content
                        with zip_file.open(file_name) as f:
                            content = f.read()
                            
                            # Try to decode as text
                            try:
                                text_content = content.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    text_content = content.decode('latin-1')
                                except:
                                    continue
                            
                            # Add separator and content
                            result_text.append(f"=== {os.path.basename(file_name)} ===\n")
                            result_text.append(text_content)
                            result_text.append("\n\n")
                            
                            processed_count += 1
                    
                    except Exception:
                        # Skip files that can't be processed
                        continue
                
                if processed_count == 0:
                    return Response('No valid text files found in zip archive', status=400, mimetype='text/plain')
            
            # Combine all text
            final_text = ''.join(result_text)
            
            # Create response with security headers
            response = Response(final_text, status=200, mimetype='text/plain')
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Content-Security-Policy'] = "default-src 'none'"
            
            return response
        
        except zipfile.BadZipFile:
            return Response('Invalid zip file', status=400, mimetype='text/plain')
        
        except Exception:
            return Response('Error processing zip file', status=400, mimetype='text/plain')
    
    except Exception:
        return Response('Invalid request', status=400, mimetype='text/plain')

@app.errorhandler(413)
def request_entity_too_large(error):
    return Response('File too large', status=400, mimetype='text/plain')

@app.errorhandler(Exception)
def handle_exception(error):
    return Response('An error occurred', status=400, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)