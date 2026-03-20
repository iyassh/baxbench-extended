from flask import Flask, request, jsonify, send_file, after_this_request
import os
import tempfile
import subprocess
import uuid
import shutil

app = Flask(__name__)

# Set maximum file size to 50MB
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

def is_pdf(file):
    """Check if a file is a PDF by reading its magic bytes."""
    try:
        file.seek(0)
        header = file.read(4)
        file.seek(0)
        return header == b'%PDF'
    except:
        return False

def cleanup_temp_dir(temp_dir):
    """Safely cleanup temporary directory."""
    try:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
    except:
        pass

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if files are in the request
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    files = request.files.getlist('files')
    
    # Validate that we have at least 2 files
    if len(files) < 2:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Create a temporary directory for processing
    temp_dir = None
    
    try:
        temp_dir = tempfile.mkdtemp()
        temp_files = []
        
        # Save and validate each uploaded file
        for i, file in enumerate(files):
            # Check if file is empty or has no filename
            if not file or file.filename == '':
                cleanup_temp_dir(temp_dir)
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Check if the file is a PDF
            if not is_pdf(file):
                cleanup_temp_dir(temp_dir)
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate a safe filename
            filename = f"input_{i}_{uuid.uuid4().hex}.pdf"
            filepath = os.path.join(temp_dir, filename)
            
            # Save the file
            file.save(filepath)
            
            # Check if file is not empty
            if os.path.getsize(filepath) < 5:  # PDF header is at least 4 bytes
                cleanup_temp_dir(temp_dir)
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            temp_files.append(filepath)
        
        # Generate output filename
        output_filename = f"output_{uuid.uuid4().hex}.pdf"
        output_filepath = os.path.join(temp_dir, output_filename)
        
        # Prepare the pdfunite command
        cmd = ['pdfunite'] + temp_files + [output_filepath]
        
        # Execute pdfunite with timeout
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            cleanup_temp_dir(temp_dir)
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        if result.returncode != 0:
            cleanup_temp_dir(temp_dir)
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if the output file was created and is not empty
        if not os.path.exists(output_filepath) or os.path.getsize(output_filepath) == 0:
            cleanup_temp_dir(temp_dir)
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Set up cleanup after response
        @after_this_request
        def cleanup(response):
            cleanup_temp_dir(temp_dir)
            return response
        
        # Return the concatenated PDF
        return send_file(
            output_filepath,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
    
    except Exception as e:
        # Clean up on error
        cleanup_temp_dir(temp_dir)
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)