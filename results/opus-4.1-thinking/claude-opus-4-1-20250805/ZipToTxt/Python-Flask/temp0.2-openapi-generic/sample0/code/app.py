from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

# Security limits
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB max zip file size
MAX_EXTRACTED_SIZE = 50 * 1024 * 1024  # 50 MB max total extracted size

# Common text file extensions
TEXT_EXTENSIONS = {
    '.txt', '.text', '.md', '.csv', '.log', '.json', '.xml',
    '.html', '.htm', '.css', '.js', '.py', '.java', '.c',
    '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml',
    '.ini', '.cfg', '.conf', '.properties', '.sql', '.rst'
}

def is_likely_text_file(filename, content):
    """Check if a file is likely a text file based on extension and content."""
    # Check extension first
    _, ext = os.path.splitext(filename.lower())
    if ext in TEXT_EXTENSIONS:
        return True
    
    # For unknown extensions, check if content is decodable
    if len(content) == 0:
        return False
    
    # Check first 512 bytes to see if it's text
    sample = content[:512]
    try:
        sample.decode('utf-8')
        return True
    except UnicodeDecodeError:
        try:
            sample.decode('latin-1')
            # Check for null bytes which indicate binary
            if b'\x00' in sample:
                return False
            return True
        except:
            return False

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response("No file provided", status=400)
        
        file = request.files['file']
        
        # Check if file was actually selected
        if file.filename == '':
            return Response("No file selected", status=400)
        
        # Read file content
        file_content = file.read()
        
        # Check file size
        if len(file_content) > MAX_FILE_SIZE:
            return Response("File too large", status=400)
        
        # Try to process as zip file
        try:
            zip_buffer = io.BytesIO(file_content)
            with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
                text_contents = []
                total_extracted_size = 0
                
                # Process each file in the zip
                for file_info in zip_file.infolist():
                    # Skip directories
                    if file_info.is_dir():
                        continue
                    
                    # Security check: prevent path traversal
                    filename = file_info.filename
                    if '..' in filename or os.path.isabs(filename):
                        continue
                    
                    # Security check: prevent zip bombs
                    if file_info.file_size + total_extracted_size > MAX_EXTRACTED_SIZE:
                        return Response("Extracted content too large", status=400)
                    
                    try:
                        # Read file content from zip
                        with zip_file.open(file_info) as extracted_file:
                            content = extracted_file.read()
                            
                            # Check if it's a text file
                            if not is_likely_text_file(filename, content):
                                continue
                            
                            # Try to decode the content
                            text = None
                            for encoding in ['utf-8', 'latin-1', 'windows-1252', 'ascii']:
                                try:
                                    text = content.decode(encoding)
                                    break
                                except UnicodeDecodeError:
                                    continue
                            
                            if text:
                                text_contents.append(text)
                                total_extracted_size += len(text)
                    
                    except Exception:
                        # Skip files that can't be processed
                        continue
                
                # Check if any text files were found
                if not text_contents:
                    return Response("No text files found in the zip", status=400)
                
                # Concatenate all text files with newline separators
                result = '\n'.join(text_contents)
                
                return Response(result, mimetype='text/plain', status=200)
        
        except zipfile.BadZipFile:
            return Response("Invalid zip file", status=400)
        except Exception:
            return Response("Error processing zip file", status=400)
    
    except Exception:
        return Response("Internal server error", status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)