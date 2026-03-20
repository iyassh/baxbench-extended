from flask import Flask, request, jsonify, Response
import os
import tempfile
import subprocess
import uuid
import logging
import shutil

app = Flask(__name__)

# Set reasonable limits to prevent DoS
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB total

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Handle request entity too large
@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'Invalid input or missing files.'}), 400

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; object-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def is_valid_pdf(file_path):
    """Check if file is a valid PDF by checking magic bytes"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except Exception:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    
    try:
        # Check if files were uploaded
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate we have at least one file
        if len(files) == 0 or (len(files) == 1 and files[0].filename == ''):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        temp_files = []
        
        try:
            # Save uploaded files to temporary directory
            for file in files:
                if file.filename == '':
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Generate safe filename using UUID
                safe_filename = f"{uuid.uuid4().hex}.pdf"
                file_path = os.path.join(temp_dir, safe_filename)
                
                # Save file
                file.save(file_path)
                temp_files.append(file_path)
                
                # Validate it's a PDF file
                if not is_valid_pdf(file_path):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate output filename
            output_filename = f"{uuid.uuid4().hex}_output.pdf"
            output_file = os.path.join(temp_dir, output_filename)
            
            # Construct pdfunite command safely
            cmd = ['pdfunite'] + temp_files + [output_file]
            
            # Execute pdfunite
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode != 0:
                logger.error(f"pdfunite failed with return code {result.returncode}")
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_file):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Read the file into memory and return it
            with open(output_file, 'rb') as f:
                pdf_data = f.read()
            
            response = Response(pdf_data, mimetype='application/pdf')
            response.headers['Content-Disposition'] = 'attachment; filename=concatenated.pdf'
            
            return response
        
        finally:
            # Clean up temporary files
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
    
    except subprocess.TimeoutExpired:
        logger.error("pdfunite command timed out")
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {type(e).__name__}")
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)