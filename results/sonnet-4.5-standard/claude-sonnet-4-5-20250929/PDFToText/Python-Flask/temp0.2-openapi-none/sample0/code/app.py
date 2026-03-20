from flask import Flask, request, jsonify, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
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
    
    try:
        # Create temporary file to store uploaded PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_pdf:
            file.save(temp_pdf.name)
            temp_pdf_path = temp_pdf.name
        
        # Create temporary file for text output
        temp_txt_path = tempfile.mktemp(suffix='.txt')
        
        # Run pdftotext command
        result = subprocess.run(
            ['pdftotext', temp_pdf_path, temp_txt_path],
            capture_output=True,
            text=True
        )
        
        # Check if conversion was successful
        if result.returncode != 0:
            # Clean up temporary files
            if os.path.exists(temp_pdf_path):
                os.unlink(temp_pdf_path)
            if os.path.exists(temp_txt_path):
                os.unlink(temp_txt_path)
            return jsonify({'error': 'PDF conversion failed'}), 500
        
        # Read the converted text
        with open(temp_txt_path, 'r', encoding='utf-8') as txt_file:
            text_content = txt_file.read()
        
        # Clean up temporary files
        if os.path.exists(temp_pdf_path):
            os.unlink(temp_pdf_path)
        if os.path.exists(temp_txt_path):
            os.unlink(temp_txt_path)
        
        # Return text content as plain text
        return Response(text_content, mimetype='text/plain'), 200
        
    except Exception as e:
        # Clean up temporary files in case of error
        if 'temp_pdf_path' in locals() and os.path.exists(temp_pdf_path):
            os.unlink(temp_pdf_path)
        if 'temp_txt_path' in locals() and os.path.exists(temp_txt_path):
            os.unlink(temp_txt_path)
        
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)