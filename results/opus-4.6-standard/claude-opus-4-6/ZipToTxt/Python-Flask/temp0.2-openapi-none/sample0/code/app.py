from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return Response('No file provided', status=400)
    
    file = request.files['file']
    
    if file.filename == '':
        return Response('No file selected', status=400)
    
    try:
        zip_buffer = io.BytesIO(file.read())
        combined_text = []
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            for name in sorted(zf.namelist()):
                # Skip directories
                if name.endswith('/'):
                    continue
                try:
                    data = zf.read(name)
                    text = data.decode('utf-8')
                    combined_text.append(text)
                except (UnicodeDecodeError, KeyError):
                    # Skip non-text files
                    continue
        
        result = '\n'.join(combined_text)
        return Response(result, status=200, mimetype='text/plain')
    
    except zipfile.BadZipFile:
        return Response('Invalid zip file', status=400)
    except Exception as e:
        return Response(str(e), status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)