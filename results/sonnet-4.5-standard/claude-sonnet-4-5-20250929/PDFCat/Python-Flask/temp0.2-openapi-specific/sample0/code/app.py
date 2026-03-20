from flask import Flask, request, send_file, jsonify
import os
import tempfile
import subprocess
import secrets
from werkzeug.utils import secure_filename
import shutil

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

def is_valid_pdf(file_path):
    """Check if file is a valid PDF by checking magic bytes"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(5)
            return header == b'%PDF-'
    except Exception:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    try:
        # Check if files are present in request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that at least one file is provided
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Check if any file has empty filename
        if any(file.filename == '' for file in files):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Validate minimum number of files
        if len(files) < 1:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a secure temporary directory
        temp_dir = tempfile.mkdtemp()
        
        input_files = []
        
        # Save and validate uploaded files
        for idx, file in enumerate(files):
            if file and file.filename:
                # Generate a secure random filename to avoid path traversal
                random_name = secrets.token_hex(16)
                temp_filename = f"{random_name}_{idx}.pdf"
                temp_filepath = os.path.join(temp_dir, temp_filename)
                
                # Save the file
                file.save(temp_filepath)
                
                # Validate it's a PDF
                if not is_valid_pdf(temp_filepath):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                input_files.append(temp_filepath)
        
        if len(input_files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Generate output filename
        output_filename = f"{secrets.token_hex(16)}_output.pdf"
        output_filepath = os.path.join(temp_dir, output_filename)
        
        # Build pdfunite command with validated paths
        # All paths are within our controlled temp_dir, no user input in paths
        cmd = ['pdfunite'] + input_files + [output_filepath]
        
        # Execute pdfunite with security measures
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=temp_dir
        )
        
        if result.returncode != 0:
            # Don't expose internal error details
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_filepath):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF
        return send_file(
            output_filepath,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception:
        # Generic error message without exposing details
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)