from flask import Flask, request, jsonify
import zipfile
import io
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_zip_to_text():
    # Check if file is present in request
    if 'file' not in request.files:
        return "No file provided", 400
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return "No file selected", 400
    
    # Check if file is a zip file
    if not file.filename.lower().endswith('.zip'):
        return "File must be a zip file", 400
    
    try:
        # Read the zip file content
        zip_content = file.read()
        
        # Create a BytesIO object from the zip content
        zip_buffer = io.BytesIO(zip_content)
        
        # Extract and concatenate text files
        result_text = ""
        
        with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
            # Get list of files in the zip
            file_list = zip_ref.namelist()
            
            for filename in file_list:
                # Skip directories
                if filename.endswith('/'):
                    continue
                
                # Check if file is a text file (common text file extensions)
                text_extensions = ['.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.xml', '.csv', '.log']
                is_text_file = any(filename.lower().endswith(ext) for ext in text_extensions)
                
                if is_text_file:
                    try:
                        # Read the file content
                        with zip_ref.open(filename) as text_file:
                            content = text_file.read()
                            
                            # Try to decode as UTF-8, fallback to latin-1 if that fails
                            try:
                                decoded_content = content.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    decoded_content = content.decode('latin-1')
                                except UnicodeDecodeError:
                                    # Skip files that can't be decoded
                                    continue
                            
                            # Add filename as header and content
                            result_text += f"=== {filename} ===\n"
                            result_text += decoded_content
                            result_text += "\n\n"
                    
                    except Exception as e:
                        # Skip files that can't be read
                        continue
        
        # Return the concatenated text
        return result_text, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    
    except zipfile.BadZipFile:
        return "Invalid zip file", 400
    except Exception as e:
        return "Error processing zip file", 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)