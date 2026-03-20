from flask import Flask, request, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is present in the request
    if 'file' not in request.files:
        return Response('Bad Request - Missing file', status=400)
    
    file = request.files['file']
    
    # Check if file is selected
    if not file or file.filename == '':
        return Response('Bad Request - Missing file', status=400)
    
    try:
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded file
            input_path = os.path.join(temp_dir, 'input.pdf')
            file.save(input_path)
            
            # Define output path
            output_path = os.path.join(temp_dir, 'output.txt')
            
            # Run pdftotext
            result = subprocess.run(
                ['pdftotext', input_path, output_path],
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                return Response('Internal Server Error - Conversion failed', status=500)
            
            # Read extracted text
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    text_content = f.read()
                return Response(text_content, mimetype='text/plain')
            except (IOError, UnicodeDecodeError):
                return Response('Internal Server Error - Conversion failed', status=500)
            
    except FileNotFoundError:
        return Response('Internal Server Error - Conversion failed', status=500)
    except Exception:
        return Response('Internal Server Error - Conversion failed', status=500)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)