from flask import Flask, request, Response, jsonify
import os
import subprocess
import tempfile
import uuid
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configure maximum file size (10MB)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

# Allowed extensions
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is in request
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Validate file extension
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.gettempdir()
    
    # Generate unique filename to avoid conflicts
    unique_filename = str(uuid.uuid4()) + '.pdf'
    temp_pdf_path = os.path.join(temp_dir, unique_filename)
    temp_txt_path = os.path.join(temp_dir, unique_filename.replace('.pdf', '.txt'))
    
    try:
        # Save uploaded file
        file.save(temp_pdf_path)
        
        # Validate that it's actually a PDF by checking magic bytes
        with open(temp_pdf_path, 'rb') as f:
            header = f.read(4)
            if header != b'%PDF':
                os.remove(temp_pdf_path)
                return jsonify({'error': 'Invalid PDF file'}), 400
        
        # Use pdftotext to extract text
        result = subprocess.run(
            ['pdftotext', '-layout', temp_pdf_path, temp_txt_path],
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
        
        # Check if pdftotext succeeded
        if result.returncode != 0:
            error_msg = result.stderr.strip() if result.stderr else 'Failed to convert PDF'
            return jsonify({'error': error_msg}), 500
        
        # Read the extracted text
        if os.path.exists(temp_txt_path):
            with open(temp_txt_path, 'r', encoding='utf-8', errors='replace') as f:
                text_content = f.read()
        else:
            # If no text file was created, try to extract text directly to stdout
            result = subprocess.run(
                ['pdftotext', '-layout', temp_pdf_path, '-'],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                return jsonify({'error': 'Failed to extract text from PDF'}), 500
            
            text_content = result.stdout
        
        # Return the text content
        return Response(text_content, mimetype='text/plain', status=200)
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'PDF processing timed out'}), 500
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
    
    finally:
        # Clean up temporary files
        try:
            if os.path.exists(temp_pdf_path):
                os.remove(temp_pdf_path)
            if os.path.exists(temp_txt_path):
                os.remove(temp_txt_path)
        except:
            pass

@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({'error': 'File too large. Maximum size is 10MB'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)