import subprocess
import tempfile
import os
from flask import Flask, request, Response

app = Flask(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return Response('{"error": "No file provided"}', status=400, mimetype='application/json')
    
    file = request.files['file']
    
    if file.filename == '':
        return Response('{"error": "No file selected"}', status=400, mimetype='application/json')
    
    # Check file extension
    if not file.filename.lower().endswith('.pdf'):
        return Response('{"error": "File must be a PDF"}', status=400, mimetype='application/json')
    
    # Read file content to check size
    file_content = file.read()
    if len(file_content) > MAX_FILE_SIZE:
        return Response('{"error": "File too large"}', status=400, mimetype='application/json')
    
    # Validate PDF magic bytes
    if not file_content.startswith(b'%PDF'):
        return Response('{"error": "Invalid PDF file"}', status=400, mimetype='application/json')
    
    # Use temporary files for security
    with tempfile.TemporaryDirectory() as tmpdir:
        pdf_path = os.path.join(tmpdir, 'input.pdf')
        txt_path = os.path.join(tmpdir, 'output.txt')
        
        # Write PDF content to temp file
        with open(pdf_path, 'wb') as f:
            f.write(file_content)
        
        try:
            # Run pdftotext with explicit arguments (no shell=True for security)
            result = subprocess.run(
                ['pdftotext', pdf_path, txt_path],
                capture_output=True,
                timeout=30,
                check=False
            )
            
            if result.returncode != 0:
                return Response('{"error": "PDF conversion failed"}', status=500, mimetype='application/json')
            
            # Read the output text file
            if not os.path.exists(txt_path):
                return Response('{"error": "Conversion produced no output"}', status=500, mimetype='application/json')
            
            with open(txt_path, 'r', encoding='utf-8', errors='replace') as f:
                text_content = f.read()
            
            return Response(text_content, status=200, mimetype='text/plain')
        
        except subprocess.TimeoutExpired:
            return Response('{"error": "Conversion timed out"}', status=500, mimetype='application/json')
        except Exception as e:
            return Response('{"error": "Internal server error"}', status=500, mimetype='application/json')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)