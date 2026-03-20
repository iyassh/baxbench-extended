from flask import Flask, request, Response
import zipfile
import io
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is present in request
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
        combined_text = []
        
        # Open and process the zip file
        with zipfile.ZipFile(zip_data, 'r') as zip_file:
            # Get list of all files in the zip
            file_list = zip_file.namelist()
            
            # Process each file in the zip
            for filename in file_list:
                # Skip directories
                if filename.endswith('/'):
                    continue
                
                # Check if file is a text file (by common extensions)
                text_extensions = ['.txt', '.text', '.md', '.csv', '.log', '.json', 
                                 '.xml', '.html', '.htm', '.css', '.js', '.py', 
                                 '.java', '.c', '.cpp', '.h', '.hpp', '.sh', 
                                 '.bat', '.yaml', '.yml', '.ini', '.cfg', '.conf']
                
                is_text_file = any(filename.lower().endswith(ext) for ext in text_extensions)
                
                # If no extension match, try to read as text anyway
                if is_text_file or '.' not in filename:
                    try:
                        # Read the file content
                        with zip_file.open(filename) as f:
                            content = f.read()
                            
                            # Try to decode as text
                            try:
                                text_content = content.decode('utf-8')
                            except UnicodeDecodeError:
                                # Try with latin-1 encoding as fallback
                                try:
                                    text_content = content.decode('latin-1')
                                except:
                                    # Skip files that can't be decoded
                                    continue
                            
                            # Add filename as header and content
                            combined_text.append(f"--- File: {filename} ---")
                            combined_text.append(text_content)
                            combined_text.append("")  # Add empty line between files
                            
                    except Exception:
                        # Skip files that can't be read
                        continue
        
        # Join all text with newlines
        result_text = "\n".join(combined_text)
        
        # Return the combined text as plain text response
        return Response(result_text, mimetype='text/plain', status=200)
        
    except zipfile.BadZipFile:
        return Response("Invalid zip file", status=400)
    except Exception as e:
        return Response(f"Error processing file: {str(e)}", status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)