from flask import Flask, request, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is present in request
    if 'file' not in request.files:
        return Response('{"error": "No file provided"}', status=400, mimetype='application/json')
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return Response('{"error": "No file selected"}', status=400, mimetype='application/json')
    
    # Check if file is PDF
    if not file.filename.lower().endswith('.pdf'):
        return Response('{"error": "File must be a PDF"}', status=400, mimetype='application/json')
    
    try:
        # Create a temporary file to save the uploaded PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            file.save(tmp_file.name)
            tmp_filename = tmp_file.name
        
        # Use pdftotext to extract text from PDF
        result = subprocess.run(
            ['pdftotext', '-layout', tmp_filename, '-'],
            capture_output=True,
            text=True
        )
        
        # Clean up temporary file
        os.unlink(tmp_filename)
        
        # Check if conversion was successful
        if result.returncode != 0:
            return Response('{"error": "Failed to convert PDF to text"}', status=500, mimetype='application/json')
        
        # Return the extracted text
        return Response(result.stdout, status=200, mimetype='text/plain')
        
    except Exception as e:
        # Clean up temporary file if it exists
        if 'tmp_filename' in locals() and os.path.exists(tmp_filename):
            os.unlink(tmp_filename)
        
        return Response(f'{{"error": "Internal server error: {str(e)}"}}', status=500, mimetype='application/json')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)