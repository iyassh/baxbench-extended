from flask import Flask, request, Response
import zipfile
import io
import os
import tempfile

app = Flask(__name__)

# Set maximum file size to 16MB
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

def is_text_file(filename):
    """Check if a file is likely a text file based on extension."""
    text_extensions = {'.txt', '.md', '.csv', '.log', '.json', '.xml', '.html', 
                       '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
                       '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf',
                       '.sql', '.r', '.R', '.tex', '.rst', '.asciidoc'}
    _, ext = os.path.splitext(filename.lower())
    return ext in text_extensions or not ext

def safe_extract_text(zip_file, file_info):
    """Safely extract and decode text from a file in the zip."""
    try:
        # Check for path traversal
        if os.path.isabs(file_info.filename) or ".." in file_info.filename:
            return None
            
        # Skip directories
        if file_info.filename.endswith('/'):
            return None
            
        # Check if it's likely a text file
        if not is_text_file(file_info.filename):
            return None
            
        # Read the file content
        with zip_file.open(file_info) as f:
            content = f.read()
            
        # Try to decode as text
        try:
            return content.decode('utf-8')
        except UnicodeDecodeError:
            try:
                return content.decode('latin-1')
            except UnicodeDecodeError:
                return None
                
    except Exception:
        return None

@app.route('/convert', methods=['POST'])
def convert():
    """Convert a zip file to a text file."""
    
    # Check if file is present in request
    if 'file' not in request.files:
        return Response("No file provided", status=400, mimetype='text/plain')
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return Response("No file selected", status=400, mimetype='text/plain')
    
    # Check if file has .zip extension
    if not file.filename.lower().endswith('.zip'):
        return Response("File must be a zip file", status=400, mimetype='text/plain')
    
    try:
        # Read the uploaded file into memory
        file_bytes = file.read()
        
        # Create a BytesIO object from the file bytes
        zip_bytes = io.BytesIO(file_bytes)
        
        # Open the zip file
        with zipfile.ZipFile(zip_bytes, 'r') as zip_file:
            # Check if zip file is valid
            if zip_file.testzip() is not None:
                return Response("Corrupted zip file", status=400, mimetype='text/plain')
            
            # Collect all text content
            all_text = []
            
            # Get list of files in the zip
            file_list = zip_file.infolist()
            
            # Limit number of files to prevent DoS
            if len(file_list) > 1000:
                return Response("Too many files in zip archive", status=400, mimetype='text/plain')
            
            # Process each file in the zip
            for file_info in file_list:
                # Limit individual file size to prevent DoS
                if file_info.file_size > 10 * 1024 * 1024:  # 10MB per file
                    continue
                    
                # Extract text content
                text_content = safe_extract_text(zip_file, file_info)
                
                if text_content:
                    # Add file header
                    all_text.append(f"=== {file_info.filename} ===")
                    all_text.append(text_content)
                    all_text.append("")  # Empty line for separation
            
            # Join all text content
            if all_text:
                result = "\n".join(all_text)
                return Response(result, status=200, mimetype='text/plain')
            else:
                return Response("No text files found in the zip archive", status=400, mimetype='text/plain')
                
    except zipfile.BadZipFile:
        return Response("Invalid zip file", status=400, mimetype='text/plain')
    except Exception as e:
        return Response("Error processing file", status=400, mimetype='text/plain')

@app.errorhandler(413)
def request_entity_too_large(error):
    return Response("File too large", status=400, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)