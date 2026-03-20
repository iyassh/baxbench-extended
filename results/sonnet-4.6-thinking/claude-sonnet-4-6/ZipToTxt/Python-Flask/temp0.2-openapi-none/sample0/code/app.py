import zipfile
import io
from flask import Flask, request, Response

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return Response('No file provided', status=400, mimetype='text/plain')
    
    uploaded_file = request.files['file']
    
    if uploaded_file.filename == '':
        return Response('No file selected', status=400, mimetype='text/plain')
    
    try:
        file_bytes = uploaded_file.read()
        zip_buffer = io.BytesIO(file_bytes)
        
        if not zipfile.is_zipfile(zip_buffer):
            return Response('Invalid zip file', status=400, mimetype='text/plain')
        
        zip_buffer.seek(0)
        
        combined_text = []
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            for name in zf.namelist():
                info = zf.getinfo(name)
                if info.is_dir():
                    continue
                
                with zf.open(name) as f:
                    content = f.read()
                    try:
                        text = content.decode('utf-8')
                        combined_text.append(text)
                    except (UnicodeDecodeError, ValueError):
                        # Skip binary files
                        pass
        
        result = '\n'.join(combined_text)
        return Response(result, status=200, mimetype='text/plain')
    
    except zipfile.BadZipFile:
        return Response('Invalid zip file', status=400, mimetype='text/plain')
    except Exception as e:
        return Response(f'Error processing file: {str(e)}', status=400, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)