import os
import zipfile
import tempfile
import shutil
from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename
import mimetypes

app = Flask(__name__)

# Security configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_text_file(filename):
    """Check if a file is likely a text file based on extension and mime type."""
    text_extensions = {
        '.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.xml', 
        '.csv', '.log', '.ini', '.cfg', '.conf', '.yml', '.yaml',
        '.sql', '.sh', '.bat', '.c', '.cpp', '.h', '.java', '.php',
        '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.pl', '.r'
    }
    
    # Check extension
    _, ext = os.path.splitext(filename.lower())
    if ext in text_extensions:
        return True
    
    # Check mime type
    mime_type, _ = mimetypes.guess_type(filename)
    if mime_type and mime_type.startswith('text/'):
        return True
    
    return False

def safe_extract_path(zip_path, extract_to):
    """Safely extract a zip file, preventing path traversal attacks."""
    # Normalize the extraction path
    extract_to = os.path.abspath(extract_to)
    
    # Check if the zip path tries to escape the extraction directory
    zip_path = os.path.normpath(zip_path)
    if zip_path.startswith('/') or '..' in zip_path or zip_path.startswith('..'):
        return None
    
    # Construct the full path
    full_path = os.path.join(extract_to, zip_path)
    full_path = os.path.abspath(full_path)
    
    # Ensure the path is within the extraction directory
    if not full_path.startswith(extract_to):
        return None
    
    return full_path

def process_zip_file(zip_file_path):
    """Process a zip file and extract text content from all text files."""
    text_content = []
    temp_dir = None
    
    try:
        # Create a temporary directory for extraction
        temp_dir = tempfile.mkdtemp()
        
        with zipfile.ZipFile(zip_file_path, 'r') as zip_ref:
            # Check for zip bomb protection
            total_size = 0
            file_count = 0
            
            for file_info in zip_ref.infolist():
                file_count += 1
                total_size += file_info.file_size
                
                # Limit number of files and total uncompressed size
                if file_count > 1000:
                    raise ValueError("Too many files in zip archive")
                if total_size > 100 * 1024 * 1024:  # 100MB limit
                    raise ValueError("Uncompressed size too large")
            
            # Extract and process files
            for file_info in zip_ref.infolist():
                if file_info.is_dir():
                    continue
                
                # Get safe extraction path
                safe_path = safe_extract_path(file_info.filename, temp_dir)
                if safe_path is None:
                    continue  # Skip files with unsafe paths
                
                # Check if it's a text file
                if not is_text_file(file_info.filename):
                    continue
                
                # Create directory structure if needed
                os.makedirs(os.path.dirname(safe_path), exist_ok=True)
                
                # Extract the file
                with zip_ref.open(file_info) as source, open(safe_path, 'wb') as target:
                    # Limit individual file size
                    max_file_size = 10 * 1024 * 1024  # 10MB per file
                    copied = 0
                    while True:
                        chunk = source.read(8192)
                        if not chunk:
                            break
                        copied += len(chunk)
                        if copied > max_file_size:
                            raise ValueError("Individual file too large")
                        target.write(chunk)
                
                # Read the text content
                try:
                    with open(safe_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if content.strip():  # Only add non-empty files
                            text_content.append(f"=== {file_info.filename} ===\n")
                            text_content.append(content)
                            text_content.append("\n\n")
                except (UnicodeDecodeError, IOError):
                    # Try with different encoding or skip if can't read
                    try:
                        with open(safe_path, 'r', encoding='latin-1', errors='ignore') as f:
                            content = f.read()
                            if content.strip():
                                text_content.append(f"=== {file_info.filename} ===\n")
                                text_content.append(content)
                                text_content.append("\n\n")
                    except:
                        continue  # Skip files that can't be read
    
    except zipfile.BadZipFile:
        raise ValueError("Invalid zip file")
    except Exception as e:
        if "Too many files" in str(e) or "too large" in str(e):
            raise ValueError(str(e))
        raise ValueError("Error processing zip file")
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    return ''.join(text_content)

@app.route('/convert', methods=['POST'])
def convert_zip_to_text():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file extension
        if not file.filename.lower().endswith('.zip'):
            return jsonify({'error': 'File must be a zip archive'}), 400
        
        # Create temporary file to save uploaded zip
        temp_zip = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as temp_zip:
                file.save(temp_zip.name)
                temp_zip_path = temp_zip.name
            
            # Process the zip file
            text_content = process_zip_file(temp_zip_path)
            
            if not text_content.strip():
                return jsonify({'error': 'No text files found in zip archive'}), 400
            
            # Return the text content
            return Response(
                text_content,
                mimetype='text/plain',
                headers={'Content-Disposition': 'attachment; filename=converted.txt'}
            )
        
        finally:
            # Clean up temporary zip file
            if temp_zip and os.path.exists(temp_zip_path):
                os.unlink(temp_zip_path)
    
    except ValueError as e:
        return jsonify({'error': 'Invalid input'}), 400
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)