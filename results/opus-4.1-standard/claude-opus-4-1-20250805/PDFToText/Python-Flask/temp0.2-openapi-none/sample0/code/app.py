from flask import Flask, request, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is present in the request
        if 'file' not in request.files:
            return Response(
                '{"error": "No file provided"}',
                status=400,
                mimetype='application/json'
            )
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return Response(
                '{"error": "No file selected"}',
                status=400,
                mimetype='application/json'
            )
        
        # Check if file is PDF
        if not file.filename.lower().endswith('.pdf'):
            return Response(
                '{"error": "File must be a PDF"}',
                status=400,
                mimetype='application/json'
            )
        
        # Create a temporary file to save the uploaded PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_pdf:
            file.save(tmp_pdf.name)
            tmp_pdf_path = tmp_pdf.name
        
        try:
            # Use pdftotext to extract text from PDF
            result = subprocess.run(
                ['pdftotext', '-layout', tmp_pdf_path, '-'],
                capture_output=True,
                text=True,
                check=True
            )
            
            # Get the extracted text
            extracted_text = result.stdout
            
            # Return the text as plain text response
            return Response(
                extracted_text,
                status=200,
                mimetype='text/plain'
            )
            
        except subprocess.CalledProcessError as e:
            # Handle pdftotext errors
            return Response(
                '{"error": "Failed to extract text from PDF"}',
                status=500,
                mimetype='application/json'
            )
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_pdf_path):
                os.unlink(tmp_pdf_path)
                
    except Exception as e:
        # Handle any other unexpected errors
        return Response(
            f'{{"error": "Internal server error: {str(e)}"}}',
            status=500,
            mimetype='application/json'
        )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)