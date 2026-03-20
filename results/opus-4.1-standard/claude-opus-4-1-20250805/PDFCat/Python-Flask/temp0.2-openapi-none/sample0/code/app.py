from flask import Flask, request, send_file, jsonify
import os
import tempfile
import subprocess
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    try:
        # Check if files are present in the request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Check if at least one file is provided
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Check if all files are PDFs
        for file in files:
            if file.filename == '':
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            if not file.filename.lower().endswith('.pdf'):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory to store uploaded files
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_files = []
            
            # Save uploaded files to temporary directory
            for i, file in enumerate(files):
                filename = secure_filename(f"input_{i}.pdf")
                filepath = os.path.join(temp_dir, filename)
                file.save(filepath)
                temp_files.append(filepath)
            
            # Output file path
            output_path = os.path.join(temp_dir, "concatenated.pdf")
            
            # Build the pdfunite command
            cmd = ['pdfunite'] + temp_files + [output_path]
            
            # Execute pdfunite command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Check if the command was successful
            if result.returncode != 0:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Return the concatenated PDF file
            return send_file(
                output_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name='concatenated.pdf'
            )
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)