from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

# Maximum file size: 100MB
MAX_FILE_SIZE = 100 * 1024 * 1024

# Allowed text file extensions
TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.log', '.json', '.xml', '.html', '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bat', '.sql', '.yaml', '.yml', '.ini', '.cfg', '.conf'}

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is present in request
    if 'file' not in request.files:
        return Response("No file provided", status=400, mimetype='text/plain')
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return Response("No file selected", status=400, mimetype='text/plain')
    
    # Check if file is a zip file
    if not file.filename.lower().endswith('.zip'):
        return Response("File must be a ZIP file", status=400, mimetype='text/plain')
    
    # Read file content
    file_content = file.read()
    
    # Check file size
    if len(file_content) > MAX_FILE_SIZE:
        return Response("File size exceeds maximum allowed size (100MB)", status=400, mimetype='text/plain')
    
    # Process the zip file
    try:
        # Create a BytesIO object from the file content
        zip_buffer = io.BytesIO(file_content)
        
        # Initialize result string
        result_text = ""
        
        # Open the zip file
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            # Check for zip bombs - limit extracted size
            total_extracted_size = 0
            max_extracted_size = MAX_FILE_SIZE * 10  # 1GB max extracted
            
            # Get list of files in the zip
            file_list = zip_file.namelist()
            
            # Sort files for consistent output
            file_list.sort()
            
            for filename in file_list:
                # Skip directories
                if filename.endswith('/'):
                    continue
                
                # Get file info
                file_info = zip_file.getinfo(filename)
                
                # Check for suspicious file sizes (zip bomb protection)
                if file_info.file_size > MAX_FILE_SIZE:
                    continue
                
                total_extracted_size += file_info.file_size
                if total_extracted_size > max_extracted_size:
                    return Response("Extracted content size exceeds maximum allowed size", status=400, mimetype='text/plain')
                
                # Check if file has a text extension
                _, ext = os.path.splitext(filename.lower())
                if ext not in TEXT_EXTENSIONS:
                    continue
                
                # Prevent path traversal
                if '..' in filename or filename.startswith('/'):
                    continue
                
                try:
                    # Read the file content
                    with zip_file.open(filename) as text_file:
                        content = text_file.read()
                        
                        # Try to decode as UTF-8, skip if not possible
                        try:
                            decoded_content = content.decode('utf-8')
                            
                            # Add file separator
                            if result_text:
                                result_text += "\n\n"
                            
                            # Add filename header
                            result_text += f"=== {filename} ===\n"
                            result_text += decoded_content
                            
                        except UnicodeDecodeError:
                            # Skip files that can't be decoded as UTF-8
                            continue
                            
                except Exception:
                    # Skip files that can't be read
                    continue
        
        # Return the concatenated text
        return Response(result_text, status=200, mimetype='text/plain')
        
    except zipfile.BadZipFile:
        return Response("Invalid ZIP file", status=400, mimetype='text/plain')
    except Exception as e:
        return Response("Error processing ZIP file", status=400, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)