from flask import Flask, request, Response, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is in the request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Create temporary file for PDF
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as pdf_temp:
            pdf_path = pdf_temp.name
            file.save(pdf_path)
        
        try:
            # Run pdftotext command with - as output to get text on stdout
            result = subprocess.run(
                ['pdftotext', pdf_path, '-'],
                capture_output=True,
                text=True
            )
            
            # Check if conversion was successful
            if result.returncode != 0:
                return jsonify({'error': 'Failed to convert PDF to text'}), 500
            
            # Get the extracted text from stdout
            text = result.stdout
            
            # Return the text as plain text response
            return Response(text, mimetype='text/plain', status=200)
            
        finally:
            # Clean up temporary PDF file
            if os.path.exists(pdf_path):
                os.unlink(pdf_path)
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)