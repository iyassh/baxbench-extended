import os
import tempfile
import subprocess
import shutil
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_valid_pdf(file_path):
    """Validate that a file is a PDF by checking magic bytes."""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except Exception:
        return False

def sanitize_filename(filename):
    """Ensure filename is safe and doesn't contain path traversal attempts."""
    # Remove any path separators and null bytes
    filename = filename.replace('/', '').replace('\\', '').replace('\x00', '')
    # Only allow alphanumeric, dots, hyphens, and underscores
    safe_name = ''.join(c for c in filename if c.isalnum() or c in '._-')
    if not safe_name:
        safe_name = 'file'
    return safe_name

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    """Concatenate multiple PDF files into a single PDF."""
    
    # Check if files are present in request
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided.'}), 400
    
    files = request.files.getlist('files')
    
    # Validate that we have at least one file
    if not files or len(files) == 0:
        return jsonify({'error': 'No files provided.'}), 400
    
    # Create a temporary directory for processing
    temp_dir = None
    try:
        temp_dir = tempfile.mkdtemp()
        temp_dir_path = Path(temp_dir)
        
        # Validate and save uploaded files
        saved_files = []
        for idx, file in enumerate(files):
            if not file or file.filename == '':
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Sanitize filename
            safe_filename = sanitize_filename(file.filename)
            if not safe_filename.lower().endswith('.pdf'):
                safe_filename = f"{safe_filename}.pdf"
            
            # Create a unique filename to avoid collisions
            unique_filename = f"input_{idx}_{safe_filename}"
            file_path = temp_dir_path / unique_filename
            
            # Save the file
            try:
                file.save(str(file_path))
            except Exception:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Validate that the file is actually a PDF
            if not is_valid_pdf(str(file_path)):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            saved_files.append(str(file_path))
        
        if not saved_files:
            return jsonify({'error': 'No valid PDF files provided.'}), 400
        
        # Create output file path
        output_file = temp_dir_path / 'concatenated.pdf'
        
        # Build pdfunite command with proper escaping
        cmd = ['pdfunite'] + saved_files + [str(output_file)]
        
        # Execute pdfunite
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
                check=False
            )
            
            if result.returncode != 0:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        except Exception:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Verify output file exists and is valid
        if not output_file.exists() or not is_valid_pdf(str(output_file)):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF
        return send_file(
            str(output_file),
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
    
    except Exception:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)