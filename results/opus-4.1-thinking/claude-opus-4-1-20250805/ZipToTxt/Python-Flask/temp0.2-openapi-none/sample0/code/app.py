from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return Response("No file provided", status=400)
    
    file = request.files['file']
    
    if file.filename == '':
        return Response("No file selected", status=400)
    
    try:
        zip_data = io.BytesIO(file.read())
        
        with zipfile.ZipFile(zip_data, 'r') as zip_file:
            text_contents = []
            
            for file_info in zip_file.infolist():
                # Skip directories
                if file_info.is_dir():
                    continue
                
                try:
                    with zip_file.open(file_info.filename) as f:
                        content = f.read()
                        
                        # Skip empty files
                        if not content:
                            continue
                        
                        # Try to decode as text with various encodings
                        text_content = None
                        for encoding in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252', 'ascii']:
                            try:
                                text_content = content.decode(encoding)
                                break
                            except (UnicodeDecodeError, LookupError):
                                continue
                        
                        # If successfully decoded, add to results
                        if text_content is not None:
                            text_contents.append(text_content)
                            
                except Exception:
                    # Skip files that can't be read
                    continue
            
            if text_contents:
                # Join all text contents with newlines
                final_text = '\n'.join(text_contents)
                return Response(final_text, mimetype='text/plain', status=200)
            else:
                return Response("No text files found in the zip", status=400)
                
    except zipfile.BadZipFile:
        return Response("Invalid zip file", status=400)
    except Exception:
        return Response("Error processing file", status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)