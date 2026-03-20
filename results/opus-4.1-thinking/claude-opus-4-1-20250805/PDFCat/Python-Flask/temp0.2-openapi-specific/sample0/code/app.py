from flask import Flask, request, jsonify, make_response
import os
import tempfile
import subprocess
import uuid
import shutil

app = Flask(__name__)

# Maximum file size: 100MB
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

def add_security_headers(response):
    """Add security headers to the response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Add security headers to all responses"""
    return add_security_headers(response)

def is_pdf(file_content):
    """Check if the file content starts with PDF magic bytes"""
    return file_content.startswith(b'%PDF')

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least one file
        if not files or len(files) == 0:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        # Filter out empty files
        valid_files = [f for f in files if f and f.filename]
        
        if not valid_files:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp(prefix='pdf_concat_')
        
        saved_files = []
        
        # Save and validate each uploaded file
        for idx, file in enumerate(valid_files):
            try:
                # Read file content to validate
                file_content = file.read()
                
                # Check if it's a PDF
                if not is_pdf(file_content):
                    return jsonify({"error": "Invalid input or missing files."}), 400
                
                # Generate safe filename using UUID to prevent path traversal
                safe_filename = f"input_{uuid.uuid4().hex}_{idx}.pdf"
                file_path = os.path.join(temp_dir, safe_filename)
                
                # Ensure we're writing within temp_dir
                if not os.path.abspath(file_path).startswith(os.path.abspath(temp_dir)):
                    return jsonify({"error": "Invalid input or missing files."}), 400
                
                # Save the file
                with open(file_path, 'wb') as f:
                    f.write(file_content)
                
                saved_files.append(file_path)
            
            except Exception:
                return jsonify({"error": "An error occurred while processing the files."}), 500
        
        if len(saved_files) < 1:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        # Generate output filename
        output_filename = f"output_{uuid.uuid4().hex}.pdf"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Ensure output path is within temp_dir
        if not os.path.abspath(output_path).startswith(os.path.abspath(temp_dir)):
            return jsonify({"error": "An error occurred while processing the files."}), 500
        
        # Prepare command for pdfunite
        # Using list format to avoid shell injection
        cmd = ['pdfunite'] + saved_files + [output_path]
        
        # Execute pdfunite command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            cwd=temp_dir,  # Run in temp directory
            shell=False  # Explicitly disable shell
        )
        
        # Check if command was successful
        if result.returncode != 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500
        
        # Verify output file exists
        if not os.path.exists(output_path):
            return jsonify({"error": "An error occurred while processing the files."}), 500
        
        # Read the output file
        with open(output_path, 'rb') as f:
            pdf_content = f.read()
        
        # Create response with PDF content
        response = make_response(pdf_content)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = 'attachment; filename=concatenated.pdf'
        
        return response, 200
        
    except subprocess.TimeoutExpired:
        return jsonify({"error": "An error occurred while processing the files."}), 500
    except Exception:
        # Don't expose internal error details
        return jsonify({"error": "An error occurred while processing the files."}), 500
    finally:
        # Always clean up temp directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass  # Ignore cleanup errors

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error"""
    return jsonify({"error": "Invalid input or missing files."}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing details"""
    return jsonify({"error": "An error occurred while processing the files."}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)