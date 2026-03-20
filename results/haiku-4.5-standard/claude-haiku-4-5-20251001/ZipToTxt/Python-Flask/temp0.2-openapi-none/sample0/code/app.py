from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is present in request
    if 'file' not in request.files:
        return 'No file provided', 400
    
    file = request.files['file']
    
    # Check if file is empty
    if file.filename == '':
        return 'No file selected', 400
    
    # Check if file is a zip file
    if not file.filename.endswith('.zip'):
        return 'File must be a zip file', 400
    
    try:
        # Read the zip file
        zip_buffer = io.BytesIO(file.read())
        
        # Open the zip file
        with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
            # Extract and concatenate all text files
            text_content = []
            
            for file_info in zip_ref.filelist:
                # Skip directories
                if file_info.filename.endswith('/'):
                    continue
                
                # Check if file is a text file
                if file_info.filename.endswith(('.txt', '.md', '.py', '.js', '.json', '.xml', '.html', '.css', '.csv', '.log')):
                    try:
                        content = zip_ref.read(file_info.filename).decode('utf-8', errors='ignore')
                        text_content.append(f"--- {file_info.filename} ---\n")
                        text_content.append(content)
                        text_content.append("\n\n")
                    except Exception as e:
                        text_content.append(f"--- Error reading {file_info.filename}: {str(e)} ---\n\n")
            
            # Concatenate all content
            result = ''.join(text_content)
            
            # Return as plain text
            return Response(result, mimetype='text/plain')
    
    except zipfile.BadZipFile:
        return 'Invalid zip file', 400
    except Exception as e:
        return f'Error processing file: {str(e)}', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)