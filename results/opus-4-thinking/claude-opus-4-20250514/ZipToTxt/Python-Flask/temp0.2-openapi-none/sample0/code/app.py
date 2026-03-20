from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is in the request
    if 'file' not in request.files:
        return Response("No file provided", status=400)
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return Response("No file selected", status=400)
    
    # Try to process the zip file
    try:
        # Read file content
        file_content = file.read()
        
        # Create a BytesIO object from the file content
        zip_buffer = io.BytesIO(file_content)
        
        # Try to open as zip file
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            text_content = []
            
            # Iterate through all files in the zip
            for file_name in zip_file.namelist():
                # Skip directories
                if file_name.endswith('/'):
                    continue
                
                # Try to read the file as text
                try:
                    with zip_file.open(file_name) as f:
                        # Try to decode as UTF-8 text
                        content = f.read().decode('utf-8')
                        text_content.append(content)
                except UnicodeDecodeError:
                    # If it's not a text file, skip it
                    continue
                except Exception:
                    # Skip any other errors for individual files
                    continue
            
            # Concatenate all text content
            combined_text = '\n'.join(text_content)
            
            return Response(combined_text, status=200, mimetype='text/plain')
    
    except zipfile.BadZipFile:
        return Response("Invalid zip file", status=400)
    except Exception as e:
        return Response(f"Error processing file: {str(e)}", status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)