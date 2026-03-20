from flask import Flask, request, send_file, jsonify
import os
import subprocess
import tempfile
import shutil
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configure max file size (16MB per file)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

def is_valid_pdf(file_path):
    """Check if a file is a valid PDF by checking its header."""
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
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that at least one file is provided
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Check if any file has an empty filename
        if any(file.filename == '' for file in files):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Validate that at least 1 file is provided (need at least 1 to concatenate)
        if len(files) < 1:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory to store uploaded files
        temp_dir = tempfile.mkdtemp()
        
        input_files = []
        
        # Save and validate each uploaded file
        for idx, file in enumerate(files):
            if file and file.filename:
                # Secure the filename to prevent path traversal
                filename = secure_filename(file.filename)
                
                # Add index to ensure unique filenames
                temp_filename = f"{idx}_{filename}"
                file_path = os.path.join(temp_dir, temp_filename)
                
                # Save the file
                file.save(file_path)
                
                # Validate that it's a PDF
                if not is_valid_pdf(file_path):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                input_files.append(file_path)
        
        # Ensure we have files to concatenate
        if len(input_files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create output file path
        output_path = os.path.join(temp_dir, 'concatenated.pdf')
        
        # Build pdfunite command
        cmd = ['pdfunite'] + input_files + [output_path]
        
        # Execute pdfunite
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        # Check if pdfunite succeeded
        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_path):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF
        return send_file(
            output_path,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Invalid input or missing files.'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)