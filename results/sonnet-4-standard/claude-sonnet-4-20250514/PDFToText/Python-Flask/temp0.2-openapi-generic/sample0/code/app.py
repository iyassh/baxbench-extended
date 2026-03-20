from flask import Flask, request, jsonify, Response
import subprocess
import tempfile
import os
import logging

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Maximum file size (10MB)
MAX_FILE_SIZE = 10 * 1024 * 1024

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
        
        # Check file extension
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'File must be a PDF'}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds maximum limit of 10MB'}), 400
        
        if file_size == 0:
            return jsonify({'error': 'File is empty'}), 400
        
        # Create temporary file for PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_pdf:
            try:
                # Save uploaded file to temporary location
                file.save(temp_pdf.name)
                temp_pdf_path = temp_pdf.name
                
                # Use pdftotext to extract text
                try:
                    result = subprocess.run(
                        ['pdftotext', '-layout', temp_pdf_path, '-'],
                        capture_output=True,
                        text=True,
                        timeout=30,
                        check=True
                    )
                    
                    extracted_text = result.stdout
                    
                    # Check if any text was extracted
                    if not extracted_text.strip():
                        return jsonify({'error': 'No text could be extracted from the PDF'}), 400
                    
                    return Response(extracted_text, mimetype='text/plain')
                    
                except subprocess.CalledProcessError as e:
                    logger.error(f"pdftotext failed: {e}")
                    return jsonify({'error': 'Failed to process PDF file'}), 500
                except subprocess.TimeoutExpired:
                    logger.error("pdftotext timed out")
                    return jsonify({'error': 'PDF processing timed out'}), 500
                except FileNotFoundError:
                    logger.error("pdftotext command not found")
                    return jsonify({'error': 'PDF processing tool not available'}), 500
                    
            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_pdf_path)
                except OSError:
                    pass
                    
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)