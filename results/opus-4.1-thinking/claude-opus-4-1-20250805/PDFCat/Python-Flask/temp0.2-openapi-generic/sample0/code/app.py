from flask import Flask, request, Response, jsonify
import os
import tempfile
import subprocess
import uuid
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB max file size
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

def allowed_file(filename):
    """Check if the file has a PDF extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() == 'pdf'

def is_valid_pdf(filepath):
    """Basic validation to check if file is a PDF"""
    try:
        with open(filepath, 'rb') as f:
            header = f.read(5)
            return header == b'%PDF-'
    except:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least one file
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Filter out empty files
        valid_files = [f for f in files if f and f.filename != '']
        
        if len(valid_files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        temp_files = []
        
        # Save and validate uploaded files
        for file in valid_files:
            # Security: use secure filename
            original_filename = file.filename if file.filename else 'unknown.pdf'
            filename = secure_filename(original_filename)
            
            # Ensure we have a valid filename
            if not filename or filename == '':
                filename = 'file.pdf'
            
            # Validate file extension
            if not allowed_file(filename):
                shutil.rmtree(temp_dir, ignore_errors=True)
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate unique filename to avoid conflicts
            unique_filename = f"{uuid.uuid4().hex}_{filename}"
            filepath = os.path.join(temp_dir, unique_filename)
            
            # Save the file
            file.save(filepath)
            
            # Validate it's actually a PDF
            if not is_valid_pdf(filepath):
                shutil.rmtree(temp_dir, ignore_errors=True)
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            temp_files.append(filepath)
        
        # If we only have one file, read it and return
        if len(temp_files) == 1:
            with open(temp_files[0], 'rb') as f:
                pdf_data = f.read()
            shutil.rmtree(temp_dir, ignore_errors=True)
            return Response(
                pdf_data,
                mimetype='application/pdf',
                headers={'Content-Disposition': 'attachment; filename=concatenated.pdf'}
            )
        
        # Create output file path
        output_filename = f"{uuid.uuid4().hex}_output.pdf"
        output_file = os.path.join(temp_dir, output_filename)
        
        # Build pdfunite command
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite with safety measures
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,  # 60 second timeout
            cwd=temp_dir,  # Set working directory for safety
            env={'PATH': '/usr/bin:/bin'}  # Restrict PATH
        )
        
        # Check if pdfunite succeeded
        if result.returncode != 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created and read it
        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Read the concatenated PDF into memory
        with open(output_file, 'rb') as f:
            pdf_data = f.read()
        
        # Clean up temporary directory
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        # Return the concatenated PDF
        return Response(
            pdf_data,
            mimetype='application/pdf',
            headers={'Content-Disposition': 'attachment; filename=concatenated.pdf'}
        )
        
    except subprocess.TimeoutExpired:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Invalid input or missing files.'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found.'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed.'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)