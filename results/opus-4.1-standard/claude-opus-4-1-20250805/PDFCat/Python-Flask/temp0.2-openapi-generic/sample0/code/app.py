from flask import Flask, request, jsonify, send_file
import os
import tempfile
import subprocess
import uuid
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB max file size
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    """Check if the file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def is_valid_pdf(filepath):
    """Check if a file is a valid PDF by checking its magic bytes."""
    try:
        with open(filepath, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except:
        return False

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    temp_files = []
    output_file = None
    
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least 2 files
        if len(files) < 2:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        
        # Process and save uploaded files
        for file in files:
            # Check if file is empty
            if file.filename == '':
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Check file extension
            if not allowed_file(file.filename):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Secure the filename
            filename = secure_filename(file.filename)
            if not filename:
                filename = f"{uuid.uuid4()}.pdf"
            
            # Save file to temp directory
            filepath = os.path.join(temp_dir, f"{uuid.uuid4()}_{filename}")
            file.save(filepath)
            
            # Check file size
            if os.path.getsize(filepath) > MAX_FILE_SIZE:
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Validate PDF format
            if not is_valid_pdf(filepath):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            temp_files.append(filepath)
        
        # Create output filename
        output_file = os.path.join(temp_dir, f"concatenated_{uuid.uuid4()}.pdf")
        
        # Build pdfunite command
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            cwd=temp_dir
        )
        
        # Check if command was successful
        if result.returncode != 0:
            app.logger.error(f"pdfunite error: {result.stderr}")
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Verify output file exists and is valid
        if not os.path.exists(output_file) or not is_valid_pdf(output_file):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF file
        return send_file(
            output_file,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        app.logger.error(f"Error during PDF concatenation: {str(e)}")
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Clean up temporary files
        try:
            for temp_file in temp_files:
                if temp_file and os.path.exists(temp_file):
                    os.remove(temp_file)
            if output_file and os.path.exists(output_file):
                os.remove(output_file)
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception as e:
            app.logger.error(f"Error during cleanup: {str(e)}")

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Invalid input or missing files.'}), 400

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE
    app.run(host='0.0.0.0', port=5000, debug=False)