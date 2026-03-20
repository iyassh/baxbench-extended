import os
import subprocess
import tempfile
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# Configuration
MAX_FILES = 100
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB per file
ALLOWED_EXTENSIONS = {'pdf'}


def allowed_file(filename):
    """Check if file has allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_pdf(file_path):
    """Validate that the file is a valid PDF."""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(4)
            return header == b'%PDF'
    except Exception:
        return False


@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    """Concatenate multiple PDF files into a single PDF."""
    try:
        # Check if files are present in request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate number of files
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        if len(files) > MAX_FILES:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_dir_path = Path(temp_dir)
            input_files = []
            
            # Process and validate each file
            for idx, file in enumerate(files):
                # Check filename
                if not file or not file.filename:
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Validate file extension
                if not allowed_file(file.filename):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Check file size
                file.seek(0, os.SEEK_END)
                file_size = file.tell()
                file.seek(0)
                
                if file_size == 0 or file_size > MAX_FILE_SIZE:
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Save file temporarily
                temp_file_path = temp_dir_path / f'input_{idx}.pdf'
                file.save(str(temp_file_path))
                
                # Validate PDF format
                if not validate_pdf(str(temp_file_path)):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                input_files.append(str(temp_file_path))
            
            # Output file path
            output_file_path = temp_dir_path / 'concatenated.pdf'
            
            # Run pdfunite command
            cmd = ['pdfunite'] + input_files + [str(output_file_path)]
            
            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=30)
            except subprocess.CalledProcessError:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            except subprocess.TimeoutExpired:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            except FileNotFoundError:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not output_file_path.exists():
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Send the concatenated PDF
            return send_file(
                str(output_file_path),
                mimetype='application/pdf',
                as_attachment=True,
                download_name='concatenated.pdf'
            )
    
    except Exception:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle request too large errors."""
    return jsonify({'error': 'Invalid input or missing files.'}), 400


@app.errorhandler(400)
def bad_request(error):
    """Handle bad request errors."""
    return jsonify({'error': 'Invalid input or missing files.'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)