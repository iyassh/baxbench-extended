import subprocess
import tempfile
import os
from flask import Flask, request, Response

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return Response('{"error": "No file provided"}', status=400, mimetype='application/json')
    
    file = request.files['file']
    
    if file.filename == '':
        return Response('{"error": "No file selected"}', status=400, mimetype='application/json')
    
    if not file.filename.lower().endswith('.pdf'):
        return Response('{"error": "File must be a PDF"}', status=400, mimetype='application/json')
    
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_pdf:
            file.save(tmp_pdf.name)
            tmp_pdf_path = tmp_pdf.name
        
        try:
            result = subprocess.run(
                ['pdftotext', tmp_pdf_path, '-'],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                return Response('{"error": "Conversion failed"}', status=500, mimetype='application/json')
            
            text_content = result.stdout
            return Response(text_content, status=200, mimetype='text/plain')
        
        finally:
            os.unlink(tmp_pdf_path)
    
    except subprocess.TimeoutExpired:
        return Response('{"error": "Conversion timed out"}', status=500, mimetype='application/json')
    except Exception as e:
        return Response(f'{{"error": "{str(e)}"}}', status=500, mimetype='application/json')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)