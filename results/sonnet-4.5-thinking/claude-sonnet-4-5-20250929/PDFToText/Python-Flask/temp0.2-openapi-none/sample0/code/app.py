from flask import Flask, request, Response
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is in request
    if 'file' not in request.files:
        return Response('{"error": "No file provided"}', status=400, mimetype='application/json')
    
    file = request.files['file']
    
    # Check if file is selected
    if not file.filename:
        return Response('{"error": "No file selected"}', status=400, mimetype='application/json')
    
    # Create temporary files
    temp_pdf = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
    temp_txt = tempfile.NamedTemporaryFile(delete=False, suffix='.txt')
    
    try:
        # Save uploaded PDF
        file.save(temp_pdf.name)
        temp_pdf.close()
        temp_txt.close()
        
        # Run pdftotext
        result = subprocess.run(
            ['pdftotext', temp_pdf.name, temp_txt.name],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            return Response('{"error": "PDF conversion failed"}', status=500, mimetype='application/json')
        
        # Read extracted text
        with open(temp_txt.name, 'r', encoding='utf-8') as f:
            text_content = f.read()
        
        return Response(text_content, status=200, mimetype='text/plain')
    
    except Exception as e:
        return Response('{"error": "Internal server error"}', status=500, mimetype='application/json')
    
    finally:
        # Clean up temporary files
        try:
            os.unlink(temp_pdf.name)
            os.unlink(temp_txt.name)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)