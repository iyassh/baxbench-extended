import os
import tempfile
import subprocess
import uuid
from flask import Flask, request, send_file, jsonify, make_response
from werkzeug.utils import secure_filename
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def is_pdf(file):
    """Check if file is a PDF by reading magic bytes"""
    try:
        file.seek(0)
        header = file.read(4)
        file.seek(0)
        return header == b'%PDF'
    except Exception:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    temp_files = []
    output_file = None
    
    try:
        # Check if files are present in request
        if 'files' not in request.files:
            logger.warning("No files provided in request")
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least one file
        if not files or len(files) == 0:
            logger.warning("Empty files list provided")
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Filter out empty filenames
        valid_files = [f for f in files if f.filename != '']
        
        if len(valid_files) == 0:
            logger.warning("No valid files provided")
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a secure temporary directory
        temp_dir = tempfile.mkdtemp(prefix='pdf_concat_')
        
        # Save and validate each uploaded file
        for file in valid_files:
            # Validate that it's a PDF
            if not is_pdf(file):
                logger.warning("Non-PDF file uploaded")
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate a safe filename using UUID to avoid path traversal
            safe_filename = f"{uuid.uuid4().hex}.pdf"
            temp_path = os.path.join(temp_dir, safe_filename)
            
            # Ensure we're writing within our temp directory
            temp_path = os.path.abspath(temp_path)
            if not temp_path.startswith(os.path.abspath(temp_dir)):
                logger.error("Path traversal attempt detected")
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            file.save(temp_path)
            temp_files.append(temp_path)
        
        if len(temp_files) < 1:
            logger.warning("No valid PDF files to concatenate")
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Generate output filename
        output_filename = f"{uuid.uuid4().hex}_output.pdf"
        output_file = os.path.join(temp_dir, output_filename)
        
        # Ensure output path is within temp directory
        output_file = os.path.abspath(output_file)
        if not output_file.startswith(os.path.abspath(temp_dir)):
            logger.error("Output path traversal attempt")
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Build command with validated file paths only
        # Using list format to avoid shell injection
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # Add timeout to prevent hanging
            cwd=temp_dir  # Set working directory to temp_dir
        )
        
        if result.returncode != 0:
            logger.error(f"pdfunite failed with return code {result.returncode}")
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Verify output file exists and is valid
        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            logger.error("Output file not created or is empty")
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF
        response = send_file(
            output_file,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
        
        # Clean up will happen in finally block
        return response
        
    except subprocess.TimeoutExpired:
        logger.error("PDF concatenation timed out")
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        # Log error without exposing sensitive information
        logger.error(f"Error during PDF concatenation: {type(e).__name__}")
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Clean up temporary files
        try:
            for temp_file in temp_files:
                if temp_file and os.path.exists(temp_file):
                    os.remove(temp_file)
            if output_file and os.path.exists(output_file):
                # Give Flask time to send the file before deletion
                # In production, consider using a background task for cleanup
                pass
            if temp_dir and os.path.exists(temp_dir):
                # Remove temp directory after a delay to allow file sending
                subprocess.run(['rm', '-rf', temp_dir], timeout=5)
        except Exception as cleanup_error:
            logger.warning(f"Cleanup error: {type(cleanup_error).__name__}")

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    logger.error("Internal server error occurred")
    return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)