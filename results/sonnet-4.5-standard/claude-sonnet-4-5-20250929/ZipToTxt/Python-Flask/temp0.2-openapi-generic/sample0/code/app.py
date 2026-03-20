from flask import Flask, request, jsonify
import zipfile
import io
import os

app = Flask(__name__)

# Maximum file size: 50MB
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

def is_text_file(filename):
    """Check if a file is likely a text file based on extension."""
    text_extensions = {
        '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', 
        '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
        '.sh', '.bat', '.yaml', '.yml', '.ini', '.cfg', '.conf',
        '.log', '.sql', '.r', '.rb', '.php', '.pl', '.swift',
        '.go', '.rs', '.kt', '.ts', '.jsx', '.tsx', '.vue',
        '.scala', '.m', '.mm', '.cs', '.vb', '.lua', '.perl',
        '.asm', '.s', '.f', '.f90', '.pas', '.ada', '.lisp',
        '.clj', '.ex', '.exs', '.erl', '.hrl', '.ml', '.mli',
        '.hs', '.lhs', '.elm', '.purs', '.nim', '.cr', '.d',
        '.dart', '.groovy', '.gradle', '.properties', '.toml',
        '.rst', '.tex', '.bib', '.sty', '.cls', '.dtx', '.ins'
    }
    _, ext = os.path.splitext(filename.lower())
    return ext in text_extensions

def read_text_safely(data, filename):
    """Attempt to read binary data as text with multiple encodings."""
    encodings = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1', 'ascii']
    
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, AttributeError):
            continue
    
    # If all encodings fail, return a message
    return f"[Could not decode {filename} - binary or unsupported encoding]\n"

@app.route('/convert', methods=['POST'])
def convert_zip_to_text():
    """Convert a zip file to a single text file."""
    
    # Check if file is present in request
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Check if file is a zip file
    if not file.filename.lower().endswith('.zip'):
        return jsonify({'error': 'File must be a zip file'}), 400
    
    try:
        # Read the uploaded file into memory
        file_data = file.read()
        
        # Validate it's a valid zip file
        if len(file_data) == 0:
            return jsonify({'error': 'Empty file provided'}), 400
        
        # Create a BytesIO object from the file data
        zip_buffer = io.BytesIO(file_data)
        
        # Open the zip file
        with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
            # Get list of files in the zip
            file_list = zip_ref.namelist()
            
            if len(file_list) == 0:
                return jsonify({'error': 'Zip file is empty'}), 400
            
            # Collect text content
            text_content = []
            processed_files = 0
            
            # Sort files for consistent output
            file_list.sort()
            
            for filename in file_list:
                # Skip directories
                if filename.endswith('/'):
                    continue
                
                # Check for path traversal attempts
                if '..' in filename or filename.startswith('/'):
                    continue
                
                # Only process text files
                if not is_text_file(filename):
                    continue
                
                try:
                    # Read file content
                    with zip_ref.open(filename) as f:
                        file_data = f.read()
                        
                        # Limit individual file size to 10MB
                        if len(file_data) > 10 * 1024 * 1024:
                            text_content.append(f"\n{'='*60}\n")
                            text_content.append(f"File: {filename}\n")
                            text_content.append(f"{'='*60}\n")
                            text_content.append("[File too large to process - skipped]\n")
                            continue
                        
                        # Convert to text
                        text_data = read_text_safely(file_data, filename)
                        
                        # Add file separator and content
                        text_content.append(f"\n{'='*60}\n")
                        text_content.append(f"File: {filename}\n")
                        text_content.append(f"{'='*60}\n")
                        text_content.append(text_data)
                        text_content.append("\n")
                        
                        processed_files += 1
                        
                except Exception as e:
                    # If there's an error reading a specific file, log it and continue
                    text_content.append(f"\n{'='*60}\n")
                    text_content.append(f"File: {filename}\n")
                    text_content.append(f"{'='*60}\n")
                    text_content.append(f"[Error reading file: {str(e)}]\n")
            
            if processed_files == 0:
                return jsonify({'error': 'No text files found in zip'}), 400
            
            # Combine all text content
            result = ''.join(text_content)
            
            # Return as plain text
            return result, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    
    except zipfile.BadZipFile:
        return jsonify({'error': 'Invalid zip file'}), 400
    except Exception as e:
        return jsonify({'error': f'Error processing zip file: {str(e)}'}), 400

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error."""
    return jsonify({'error': 'File too large. Maximum size is 50MB'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)