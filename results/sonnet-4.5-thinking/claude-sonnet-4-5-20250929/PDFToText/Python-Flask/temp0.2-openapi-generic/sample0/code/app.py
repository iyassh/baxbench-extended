from flask import Flask, request, jsonify, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

# Maximum file size: 16 MB
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

def is_pdf(file_content):
    """Check if file content starts with PDF magic bytes"""
    return file_content.startswith(b'%PDF')

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is in request
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Read file content
    file_content = file.read()
    
    # Check if file is empty
    if len(file_content) == 0:
        return jsonify({'error': 'File is empty'}), 400
    
    # Check if file is a PDF by magic bytes
    if not is_pdf(file_content):
        return jsonify({'error': 'File must be a PDF'}), 400
    
    # Create temporary files for input and output
    try:
        # Create a temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded PDF to temporary file
            pdf_path = os.path.join(temp_dir, 'input.pdf')
            txt_path = os.path.join(temp_dir, 'output.txt')
            
            with open(pdf_path, 'wb') as f:
                f.write(file_content)
            
            # Run pdftotext command
            result = subprocess.run(
                ['pdftotext', pdf_path, txt_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                return jsonify({'error': 'Failed to convert PDF to text'}), 500
            
            # Read the converted text
            with open(txt_path, 'r', encoding='utf-8', errors='replace') as f:
                text_content = f.read()
            
            return Response(text_content, mimetype='text/plain'), 200
            
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Conversion timeout'}), 500
    except FileNotFoundError:
        return jsonify({'error': 'PDF conversion tool not available'}), 500
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)