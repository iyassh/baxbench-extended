from flask import Flask, request, jsonify, Response
import os
import subprocess
import tempfile
import uuid
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if files are present in the request
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    files = request.files.getlist('files')
    
    # Check if at least one file is provided
    if not files or len(files) == 0:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Check if all files have content and are PDFs
    for file in files:
        if file.filename == '' or not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Check if file has content by seeking to end
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset to beginning
        
        if file_size == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    temp_files = []
    output_file = None
    
    try:
        # Save uploaded files to temporary directory
        for i, file in enumerate(files):
            temp_filename = f"input_{i}_{secure_filename(file.filename)}"
            temp_path = os.path.join(temp_dir, temp_filename)
            file.save(temp_path)
            temp_files.append(temp_path)
        
        # Create output file path
        output_filename = f"output_{uuid.uuid4().hex}.pdf"
        output_file = os.path.join(temp_dir, output_filename)
        
        # Build pdfunite command
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_file):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Read the output file into memory
        with open(output_file, 'rb') as f:
            pdf_content = f.read()
        
        # Create response with PDF content
        response = Response(
            pdf_content,
            mimetype='application/pdf'
        )
        
        return response
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    
    finally:
        # Clean up temporary files
        try:
            for temp_file in temp_files:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            if output_file and os.path.exists(output_file):
                os.remove(output_file)
            os.rmdir(temp_dir)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)