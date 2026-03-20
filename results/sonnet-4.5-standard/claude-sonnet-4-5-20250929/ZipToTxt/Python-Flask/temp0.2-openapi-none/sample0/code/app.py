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
    
    # Check if file is empty
    if file.filename == '':
        return Response('No file selected', status=400)
    
    # Check if file is a zip file
    if not file.filename.endswith('.zip'):
        return Response('File must be a zip file', status=400)
    
    try:
        # Read the zip file
        zip_data = file.read()
        zip_buffer = io.BytesIO(zip_data)
        
        # Open the zip file
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            # Get all file names in the zip
            file_list = zip_file.namelist()
            
            # Concatenate contents of all text files
            result_text = []
            
            for filename in file_list:
                # Skip directories
                if filename.endswith('/'):
                    continue
                
                try:
                    # Read file content
                    with zip_file.open(filename) as f:
                        content = f.read()
                        
                        # Try to decode as text
                        try:
                            text_content = content.decode('utf-8')
                            result_text.append(f"=== {filename} ===\n")
                            result_text.append(text_content)
                            result_text.append("\n\n")
                        except UnicodeDecodeError:
                            # Try other encodings
                            try:
                                text_content = content.decode('latin-1')
                                result_text.append(f"=== {filename} ===\n")
                                result_text.append(text_content)
                                result_text.append("\n\n")
                            except:
                                # Skip binary files
                                continue
                except Exception as e:
                    # Skip files that can't be read
                    continue
            
            # Join all text content
            final_text = ''.join(result_text)
            
            return Response(final_text, mimetype='text/plain', status=200)
    
    except zipfile.BadZipFile:
        return Response('Invalid zip file', status=400)
    except Exception as e:
        return Response(f'Error processing zip file: {str(e)}', status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)