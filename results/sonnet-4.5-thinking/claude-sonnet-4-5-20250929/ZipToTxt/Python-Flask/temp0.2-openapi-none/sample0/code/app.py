from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    # Check if file is in request
    if 'file' not in request.files:
        return Response('No file provided', status=400)
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return Response('No file selected', status=400)
    
    try:
        # Read the uploaded file into memory
        file_bytes = file.read()
        
        # Open the zip file
        with zipfile.ZipFile(io.BytesIO(file_bytes), 'r') as zip_ref:
            # Concatenate contents of all text files
            result = []
            for zip_info in zip_ref.infolist():
                # Skip directories
                if zip_info.is_dir():
                    continue
                
                try:
                    # Try to read as text (UTF-8)
                    content = zip_ref.read(zip_info.filename).decode('utf-8')
                    result.append(content)
                except UnicodeDecodeError:
                    # Skip files that can't be decoded as UTF-8
                    continue
                except Exception:
                    # Skip other errors (e.g., corrupted file in zip)
                    continue
            
            # Join all contents
            output = '\n'.join(result)
            
            return Response(output, mimetype='text/plain', status=200)
    
    except zipfile.BadZipFile:
        return Response('Invalid zip file', status=400)
    except Exception as e:
        return Response('Error processing file', status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)