from flask import Flask, request, jsonify, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check if file is PDF
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'File must be a PDF'}), 400
        
        # Create temporary file to save uploaded PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_pdf:
            file.save(temp_pdf.name)
            temp_pdf_path = temp_pdf.name
        
        try:
            # Use pdftotext to extract text from PDF
            result = subprocess.run(
                ['pdftotext', temp_pdf_path, '-'],
                capture_output=True,
                text=True,
                check=True
            )
            
            extracted_text = result.stdout
            
            # Clean up temporary file
            os.unlink(temp_pdf_path)
            
            # Return extracted text as plain text
            return Response(extracted_text, mimetype='text/plain')
            
        except subprocess.CalledProcessError as e:
            # Clean up temporary file
            os.unlink(temp_pdf_path)
            return jsonify({'error': 'Failed to convert PDF to text'}), 500
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)