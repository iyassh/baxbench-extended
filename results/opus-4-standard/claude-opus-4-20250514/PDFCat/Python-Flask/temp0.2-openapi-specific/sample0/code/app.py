import os
import tempfile
import subprocess
import uuid
from flask import Flask, request, send_file, jsonify, make_response
from werkzeug.utils import secure_filename
import shlex

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
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
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least one file
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Check if any file is empty
        valid_files = []
        for file in files:
            if file and file.filename != '':
                valid_files.append(file)
        
        if len(valid_files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create temporary directory with restricted permissions
        temp_dir = tempfile.mkdtemp()
        os.chmod(temp_dir, 0o700)
        
        # Save uploaded files with validation
        for idx, file in enumerate(valid_files):
            # Validate file is PDF
            if not is_pdf(file):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate safe filename
            safe_filename = f"input_{uuid.uuid4().hex}_{idx}.pdf"
            temp_path = os.path.join(temp_dir, safe_filename)
            
            # Ensure path is within temp_dir (prevent path traversal)
            if not os.path.abspath(temp_path).startswith(os.path.abspath(temp_dir)):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            file.save(temp_path)
            temp_files.append(temp_path)
        
        # Generate output filename
        output_filename = f"output_{uuid.uuid4().hex}.pdf"
        output_file = os.path.join(temp_dir, output_filename)
        
        # Ensure output path is within temp_dir
        if not os.path.abspath(output_file).startswith(os.path.abspath(temp_dir)):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Build command with proper escaping
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite with timeout and capture output
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=temp_dir,
                env={'PATH': '/usr/bin:/bin'}  # Restrict PATH
            )
            
            if result.returncode != 0:
                # Don't expose internal error details
                app.logger.error(f"pdfunite failed: {result.stderr}")
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
                
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        except Exception:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Verify output file exists and is valid
        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF
        response = make_response(send_file(
            output_file,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        ))
        
        # Clean up temp files after sending
        try:
            for temp_file in temp_files:
                if os.path.exists(temp_file):
                    os.unlink(temp_file)
            if os.path.exists(output_file):
                os.unlink(output_file)
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception:
            pass  # Best effort cleanup
            
        return response
        
    except Exception as e:
        # Log error internally but don't expose details
        app.logger.error(f"Unexpected error: {str(e)}")
        
        # Clean up on error
        try:
            for temp_file in temp_files:
                if os.path.exists(temp_file):
                    os.unlink(temp_file)
            if output_file and os.path.exists(output_file):
                os.unlink(output_file)
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception:
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
    # Don't expose internal error details
    return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)