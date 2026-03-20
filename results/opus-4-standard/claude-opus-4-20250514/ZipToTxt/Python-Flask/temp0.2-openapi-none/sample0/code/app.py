from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is in request
    if 'file' not in request.files:
        return Response("No file provided", status=400)
    
    file = request.files['file']
    
    # Check if file is empty
    if file.filename == '':
        return Response("No file selected", status=400)
    
    # Check if file is a zip file
    if not file.filename.lower().endswith('.zip'):
        return Response("File must be a zip file", status=400)
    
    try:
        # Read the zip file from memory
        zip_data = io.BytesIO(file.read())
        
        # Initialize string to store all text content
        combined_text = ""
        
        # Open the zip file
        with zipfile.ZipFile(zip_data, 'r') as zip_file:
            # Get list of files in the zip
            file_list = zip_file.namelist()
            
            # Process each file in the zip
            for filename in file_list:
                # Skip directories
                if filename.endswith('/'):
                    continue
                
                # Check if file has a text-like extension
                text_extensions = ['.txt', '.text', '.log', '.csv', '.md', '.rst', 
                                 '.py', '.js', '.html', '.css', '.xml', '.json',
                                 '.yaml', '.yml', '.ini', '.cfg', '.conf']
                
                is_text_file = any(filename.lower().endswith(ext) for ext in text_extensions)
                
                # If no extension, try to read as text anyway
                if '.' not in os.path.basename(filename):
                    is_text_file = True
                
                if is_text_file:
                    try:
                        # Read the file content
                        with zip_file.open(filename) as f:
                            content = f.read()
                            
                            # Try to decode as UTF-8, fallback to latin-1
                            try:
                                text_content = content.decode('utf-8')
                            except UnicodeDecodeError:
                                text_content = content.decode('latin-1')
                            
                            # Add filename as header
                            combined_text += f"\n--- {filename} ---\n"
                            combined_text += text_content
                            
                            # Add newline if content doesn't end with one
                            if not text_content.endswith('\n'):
                                combined_text += '\n'
                                
                    except Exception as e:
                        # Skip files that can't be read as text
                        continue
        
        # Return the combined text
        return Response(combined_text, mimetype='text/plain', status=200)
        
    except zipfile.BadZipFile:
        return Response("Invalid zip file", status=400)
    except Exception as e:
        return Response(f"Error processing file: {str(e)}", status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)