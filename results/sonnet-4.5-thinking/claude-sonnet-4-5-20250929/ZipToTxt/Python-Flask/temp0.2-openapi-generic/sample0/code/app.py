from flask import Flask, request, Response
from werkzeug.exceptions import RequestEntityTooLarge
import zipfile
import io
import os

app = Flask(__name__)

# Flask configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

# Additional configuration
MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024  # 100MB
MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
ALLOWED_TEXT_EXTENSIONS = {
    '.txt', '.md', '.csv', '.log', '.json', '.xml', '.html', '.css', 
    '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', 
    '.yaml', '.yml', '.ini', '.conf', '.cfg', '.rst', '.tex'
}

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    """Handle file size exceeding limit."""
    return Response("File size exceeds maximum allowed", status=400, mimetype='text/plain')

def is_text_file(filename):
    """Check if a file is a text file based on extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_TEXT_EXTENSIONS

def safe_extract_text_from_zip(zip_data):
    """Safely extract and concatenate text files from a zip file."""
    try:
        # Read zip file from bytes
        zip_buffer = io.BytesIO(zip_data)
        
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            # Check for zip bombs - total uncompressed size
            total_size = sum(info.file_size for info in zip_file.infolist())
            if total_size > MAX_UNCOMPRESSED_SIZE:
                return None, "Uncompressed size exceeds maximum allowed"
            
            text_content = []
            
            # Iterate through all files in the zip
            for file_info in zip_file.infolist():
                # Skip directories
                if file_info.is_dir():
                    continue
                
                # Skip files that are too large
                if file_info.file_size > MAX_SINGLE_FILE_SIZE:
                    continue
                
                # Only process text files
                if is_text_file(file_info.filename):
                    try:
                        # Read file content
                        with zip_file.open(file_info) as file:
                            content = file.read()
                            
                            # Try to decode as text
                            try:
                                text = content.decode('utf-8')
                            except UnicodeDecodeError:
                                # Try other common encodings
                                try:
                                    text = content.decode('latin-1')
                                except:
                                    # Skip files that can't be decoded
                                    continue
                            
                            # Add file header and content
                            text_content.append(f"=== {file_info.filename} ===\n")
                            text_content.append(text)
                            text_content.append("\n\n")
                    except Exception:
                        # Skip files that can't be read
                        continue
            
            if not text_content:
                return None, "No text files found in zip"
            
            return ''.join(text_content), None
            
    except zipfile.BadZipFile:
        return None, "Invalid zip file"
    except Exception:
        return None, "Error processing zip file"

@app.route('/convert', methods=['POST'])
def convert():
    """Convert a zip file to a single text file."""
    # Check if file is in request
    if 'file' not in request.files:
        return Response("No file provided", status=400, mimetype='text/plain')
    
    file = request.files['file']
    
    # Check if file is selected
    if not file or file.filename == '':
        return Response("No file selected", status=400, mimetype='text/plain')
    
    # Check file extension
    if not file.filename.lower().endswith('.zip'):
        return Response("File must be a zip file", status=400, mimetype='text/plain')
    
    # Read file data
    file_data = file.read()
    
    # Check if file is empty
    if len(file_data) == 0:
        return Response("File is empty", status=400, mimetype='text/plain')
    
    # Process the zip file
    result, error = safe_extract_text_from_zip(file_data)
    
    if error:
        return Response(error, status=400, mimetype='text/plain')
    
    return Response(result, status=200, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)