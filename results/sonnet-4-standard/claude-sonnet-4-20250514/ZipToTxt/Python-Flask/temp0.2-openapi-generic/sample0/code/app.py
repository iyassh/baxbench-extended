from flask import Flask, request, jsonify, Response
import zipfile
import io
import os
import mimetypes

app = Flask(__name__)

# Set maximum file size to 16MB
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

def is_text_file(filename, content):
    """
    Determine if a file is a text file based on extension and content.
    """
    # Check by extension first
    text_extensions = {
        '.txt', '.md', '.py', '.js', '.html', '.htm', '.css', '.json', 
        '.xml', '.csv', '.log', '.ini', '.cfg', '.conf', '.yaml', '.yml',
        '.sql', '.sh', '.bat', '.ps1', '.c', '.cpp', '.h', '.java', '.php',
        '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.pl', '.r', '.m',
        '.dockerfile', '.gitignore', '.gitattributes', '.editorconfig'
    }
    
    _, ext = os.path.splitext(filename.lower())
    if ext in text_extensions:
        return True
    
    # Check MIME type
    mime_type, _ = mimetypes.guess_type(filename)
    if mime_type and mime_type.startswith('text/'):
        return True
    
    # Check if content appears to be text (heuristic)
    try:
        # Try to decode as UTF-8
        content.decode('utf-8')
        # Check if content contains mostly printable characters
        printable_chars = sum(1 for byte in content if 32 <= byte <= 126 or byte in [9, 10, 13])
        if len(content) > 0 and printable_chars / len(content) > 0.7:
            return True
    except UnicodeDecodeError:
        pass
    
    return False

def extract_text_from_zip(zip_file):
    """
    Extract text content from all text files in a zip archive.
    """
    text_content = []
    
    try:
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            for file_info in zip_ref.filelist:
                # Skip directories
                if file_info.is_dir():
                    continue
                
                # Skip files that are too large (>1MB per file)
                if file_info.file_size > 1024 * 1024:
                    continue
                
                try:
                    # Read file content
                    with zip_ref.open(file_info) as file:
                        content = file.read()
                    
                    # Check if it's a text file
                    if is_text_file(file_info.filename, content):
                        try:
                            # Try to decode as UTF-8 first
                            text = content.decode('utf-8')
                        except UnicodeDecodeError:
                            try:
                                # Fallback to latin-1
                                text = content.decode('latin-1')
                            except UnicodeDecodeError:
                                # Skip files that can't be decoded
                                continue
                        
                        # Add file separator and content
                        text_content.append(f"=== {file_info.filename} ===\n")
                        text_content.append(text)
                        text_content.append("\n\n")
                
                except (zipfile.BadZipFile, RuntimeError, ValueError):
                    # Skip corrupted or encrypted files
                    continue
    
    except zipfile.BadZipFile:
        raise ValueError("Invalid zip file")
    
    return ''.join(text_content)

@app.route('/convert', methods=['POST'])
def convert_zip_to_text():
    """
    Convert a zip file to a single text file containing all text file contents.
    """
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file size
        if not file:
            return jsonify({'error': 'Invalid file'}), 400
        
        # Read file content into memory
        file_content = file.read()
        
        # Check if file is empty
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Create a BytesIO object for zipfile processing
        zip_buffer = io.BytesIO(file_content)
        
        # Extract text content
        try:
            text_content = extract_text_from_zip(zip_buffer)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        except Exception:
            return jsonify({'error': 'Error processing zip file'}), 400
        
        # Return the text content
        if not text_content.strip():
            text_content = "No text files found in the zip archive."
        
        return Response(
            text_content,
            mimetype='text/plain',
            headers={
                'Content-Disposition': 'attachment; filename=converted.txt'
            }
        )
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 400

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)