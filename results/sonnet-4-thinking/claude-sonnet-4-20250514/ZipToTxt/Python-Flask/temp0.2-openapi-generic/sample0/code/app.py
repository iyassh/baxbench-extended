from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

# Security limits
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB upload limit
MAX_EXTRACT_SIZE = 100 * 1024 * 1024  # 100MB total extract limit
MAX_INDIVIDUAL_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file limit
MAX_FILES = 1000

# Common text file extensions
TEXT_EXTENSIONS = {
    '.txt', '.md', '.py', '.js', '.html', '.htm', '.css', '.xml', '.json', 
    '.csv', '.log', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.sql', 
    '.sh', '.bat', '.ps1', '.pl', '.php', '.rb', '.go', '.java', '.c', 
    '.cpp', '.h', '.hpp', '.cs', '.vb', '.ts', '.jsx', '.tsx', '.vue',
    '.scss', '.sass', '.less', '.coffee', '.dart', '.kt', '.swift'
}

def is_text_file(filename):
    """Check if file is a text file based on extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in TEXT_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert_zip_to_text():
    try:
        # Validate request
        if 'file' not in request.files:
            return Response('No file provided', status=400)
        
        file = request.files['file']
        if file.filename == '':
            return Response('No file selected', status=400)
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return Response('File too large', status=400)
        
        if file_size == 0:
            return Response('Empty file', status=400)
        
        # Read and validate zip file
        file_content = file.read()
        
        try:
            with zipfile.ZipFile(io.BytesIO(file_content), 'r') as zip_ref:
                # Security validation
                total_size = 0
                file_count = 0
                
                for info in zip_ref.filelist:
                    if info.file_size > MAX_INDIVIDUAL_FILE_SIZE:
                        return Response('Individual file too large', status=400)
                    
                    total_size += info.file_size
                    file_count += 1
                    
                    if total_size > MAX_EXTRACT_SIZE:
                        return Response('Zip content too large', status=400)
                    
                    if file_count > MAX_FILES:
                        return Response('Too many files in zip', status=400)
                
                # Process text files
                text_content = []
                
                for filename in zip_ref.namelist():
                    # Security: prevent path traversal
                    if os.path.isabs(filename) or '..' in filename:
                        continue
                    
                    # Skip directories
                    if filename.endswith('/'):
                        continue
                    
                    # Process text files
                    if is_text_file(filename):
                        try:
                            with zip_ref.open(filename) as text_file:
                                content = text_file.read()
                                
                                # Decode content
                                decoded_content = None
                                for encoding in ['utf-8', 'latin-1', 'cp1252']:
                                    try:
                                        decoded_content = content.decode(encoding)
                                        break
                                    except UnicodeDecodeError:
                                        continue
                                
                                if decoded_content is not None:
                                    text_content.append(f"=== {filename} ===\n")
                                    text_content.append(decoded_content)
                                    text_content.append("\n\n")
                        
                        except Exception:
                            # Skip files that can't be read
                            continue
                
                # Check if any text files were found
                if not text_content:
                    return Response('No readable text files found in zip', status=400)
                
                # Return concatenated content
                result = ''.join(text_content)
                return Response(result, mimetype='text/plain')
                
        except zipfile.BadZipFile:
            return Response('Invalid zip file format', status=400)
        
    except Exception:
        return Response('Invalid input', status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)