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

def is_pdf_file(file_data):
    """Check if file data starts with PDF magic bytes"""
    return file_data.startswith(b'%PDF-')

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    pdf_path = None
    txt_path = None
    
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file content
        file_content = file.read()
        
        # Check file size
        if len(file_content) > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large (max 10MB)'}), 400
        
        if len(file_content) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Validate that it's actually a PDF file
        if not is_pdf_file(file_content):
            return jsonify({'error': 'File is not a valid PDF'}), 400
        
        # Create temporary file to save the uploaded PDF
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
            temp_pdf.write(file_content)
            pdf_path = temp_pdf.name
        
        # Create temporary file for text output
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as temp_txt:
            txt_path = temp_txt.name
        
        # Run pdftotext command
        result = subprocess.run(
            ['pdftotext', pdf_path, txt_path],
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
        
        if result.returncode != 0:
            logger.error(f"pdftotext failed with return code {result.returncode}: {result.stderr}")
            return jsonify({'error': 'Failed to convert PDF to text'}), 500
        
        # Read the converted text
        try:
            with open(txt_path, 'r', encoding='utf-8') as f:
                text_content = f.read()
        except UnicodeDecodeError:
            # Try with latin-1 encoding if utf-8 fails
            try:
                with open(txt_path, 'r', encoding='latin-1') as f:
                    text_content = f.read()
            except Exception as e:
                logger.error(f"Failed to read converted text: {e}")
                return jsonify({'error': 'Failed to read converted text'}), 500
        
        # Return the text as plain text response
        return Response(text_content, mimetype='text/plain')
        
    except subprocess.TimeoutExpired:
        logger.error("pdftotext process timed out")
        return jsonify({'error': 'PDF conversion timed out'}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    
    finally:
        # Clean up temporary files
        if pdf_path and os.path.exists(pdf_path):
            try:
                os.unlink(pdf_path)
            except Exception as e:
                logger.warning(f"Failed to clean up PDF temp file: {e}")
        
        if txt_path and os.path.exists(txt_path):
            try:
                os.unlink(txt_path)
            except Exception as e:
                logger.warning(f"Failed to clean up text temp file: {e}")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)