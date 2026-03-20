import os
import tempfile
import subprocess
import shutil
import uuid
import atexit
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Track temp dirs to clean up on exit
temp_dirs_to_cleanup = set()

def cleanup_temp_dirs():
    """Clean up any remaining temp directories on exit"""
    for temp_dir in list(temp_dirs_to_cleanup):
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            temp_dirs_to_cleanup.remove(temp_dir)
        except:
            pass

atexit.register(cleanup_temp_dirs)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def is_pdf_file(file):
    """Check if the file is a PDF based on magic bytes."""
    try:
        file.seek(0)
        header = file.read(5)
        file.seek(0)
        return header == b'%PDF-'
    except:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    try:
        # Check if files are provided
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least one file
        if len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        temp_dirs_to_cleanup.add(temp_dir)
        
        pdf_paths = []
        
        # Process each uploaded file
        for idx, file in enumerate(files):
            # Check if file has content
            if not file or file.filename == '':
                continue
            
            # Verify it's a PDF file
            if not is_pdf_file(file):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate a secure filename with UUID to avoid collisions
            safe_filename = f"{uuid.uuid4().hex}_{idx}.pdf"
            file_path = os.path.join(temp_dir, safe_filename)
            
            # Ensure we're writing within temp_dir (path traversal protection)
            if not os.path.abspath(file_path).startswith(os.path.abspath(temp_dir)):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Save the file
            file.save(file_path)
            pdf_paths.append(file_path)
        
        # Ensure we have at least one valid PDF
        if len(pdf_paths) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Generate output filename
        output_filename = f"{uuid.uuid4().hex}_concatenated.pdf"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Prepare command for pdfunite
        # Use absolute paths and pass as list to avoid shell injection
        cmd = ['pdfunite'] + pdf_paths + [output_path]
        
        # Execute pdfunite command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            cwd=temp_dir  # Set working directory to temp dir
        )
        
        # Check if command was successful
        if result.returncode != 0:
            # Don't expose internal error details
            app.logger.error(f"pdfunite error: {result.stderr}")
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Verify output file was created
        if not os.path.exists(output_path) or not os.path.isfile(output_path):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Create response with cleanup
        response = send_file(
            output_path,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
        
        # Schedule cleanup after response is sent
        @response.call_on_close
        def cleanup():
            try:
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
                    temp_dirs_to_cleanup.discard(temp_dir)
            except Exception as e:
                app.logger.error(f"Error cleaning up temp directory: {str(type(e).__name__)}")
        
        return response
        
    except subprocess.TimeoutExpired:
        app.logger.error("PDF concatenation timed out")
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
                temp_dirs_to_cleanup.discard(temp_dir)
            except:
                pass
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        # Log the error but don't expose details
        app.logger.error(f"Unexpected error: {str(type(e).__name__)}")
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
                temp_dirs_to_cleanup.discard(temp_dir)
            except:
                pass
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    app.logger.error(f"Internal server error: {str(type(e).__name__)}")
    return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)