from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is in request
    if 'file' not in request.files:
        return "No file uploaded", 400
    
    file = request.files['file']
    
    # Check if file is empty or no filename
    if not file or file.filename == '':
        return "No file selected", 400
    
    try:
        # Read the uploaded file into memory
        file_content = file.read()
        
        # Create a BytesIO object to work with zipfile
        zip_buffer = io.BytesIO(file_content)
        
        # Extract text from zip
        with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
            text_contents = []
            
            for file_info in zip_ref.filelist:
                # Skip directories
                if file_info.is_dir():
                    continue
                
                # Try to read file as text
                try:
                    with zip_ref.open(file_info.filename) as txt_file:
                        content = txt_file.read().decode('utf-8')
                        text_contents.append(content)
                except Exception:
                    # Skip files that can't be read or decoded as text
                    continue
            
            # Concatenate all text content with newlines between files
            result = '\n'.join(text_contents)
            
            return Response(result, mimetype='text/plain')
            
    except zipfile.BadZipFile:
        return "Invalid zip file", 400
    except Exception:
        return "Error processing file", 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)