from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

# Set maximum file size for security (10 MB)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

# Common text file extensions
TEXT_EXTENSIONS = {
    '.txt', '.md', '.rst', '.log', '.csv', '.json', '.xml', '.html', 
    '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', 
    '.hpp', '.cs', '.rb', '.go', '.rs', '.sh', '.bat', '.ps1',
    '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.sql'
}

def is_safe_path(filename):
    """Validate filename to prevent path traversal attacks."""
    # Normalize the path
    normalized = os.path.normpath(filename)
    # Check for directory traversal attempts
    if '..' in filename or filename.startswith('/') or os.path.isabs(normalized):
        return False
    return True

def is_text_file(filename):
    """Check if a file is likely a text file based on extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in TEXT_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert():
    """Convert zip file to concatenated text."""
    try:
        # Validate file presence in request
        if 'file' not in request.files:
            return Response("Invalid input", status=400, mimetype='text/plain')
        
        file = request.files['file']
        
        # Validate file is not empty
        if not file or file.filename == '':
            return Response("Invalid input", status=400, mimetype='text/plain')
        
        # Read file into memory
        file_data = file.read()
        
        try:
            # Open zip file
            zip_buffer = io.BytesIO(file_data)
            with zipfile.ZipFile(zip_buffer, 'r') as zf:
                text_contents = []
                
                # Process each file in the zip
                for info in zf.infolist():
                    # Skip directories
                    if info.is_dir():
                        continue
                    
                    # Security validation
                    if not is_safe_path(info.filename):
                        continue
                    
                    # Process only text files
                    if is_text_file(info.filename):
                        try:
                            # Read file data
                            data = zf.read(info.filename)
                            
                            # Try multiple encodings
                            text = None
                            for encoding in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
                                try:
                                    text = data.decode(encoding)
                                    break
                                except UnicodeDecodeError:
                                    continue
                            
                            if text:
                                text_contents.append(text)
                        
                        except Exception:
                            # Skip files that can't be read
                            pass
                
                # Return concatenated result
                if text_contents:
                    result = '\n'.join(text_contents)
                    return Response(result, status=200, mimetype='text/plain')
                else:
                    return Response("Invalid input", status=400, mimetype='text/plain')
                    
        except zipfile.BadZipFile:
            return Response("Invalid input", status=400, mimetype='text/plain')
        
    except Exception:
        return Response("Invalid input", status=400, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)