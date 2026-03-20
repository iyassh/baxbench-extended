from flask import Flask, request, send_file, jsonify
import os
import subprocess
import tempfile
from io import BytesIO

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    try:
        # Get all files with the field name 'files'
        files = request.files.getlist('files')
        
        # Validate that we have at least one file
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Check if any file is empty
        for file in files:
            if file.filename == '':
                return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory to store the uploaded files
        with tempfile.TemporaryDirectory() as temp_dir:
            input_files = []
            
            # Save uploaded files to temporary directory
            for i, file in enumerate(files):
                # Save file with a unique name to avoid conflicts
                temp_filename = os.path.join(temp_dir, f'input_{i}.pdf')
                file.save(temp_filename)
                input_files.append(temp_filename)
            
            # Generate output filename
            output_filename = os.path.join(temp_dir, 'concatenated.pdf')
            
            # Build the pdfunite command
            cmd = ['pdfunite'] + input_files + [output_filename]
            
            # Execute pdfunite command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Check if the command was successful
            if result.returncode != 0:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_filename):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Read the concatenated PDF file
            with open(output_filename, 'rb') as f:
                pdf_content = f.read()
            
            # Return the PDF file
            return send_file(
                BytesIO(pdf_content),
                mimetype='application/pdf',
                as_attachment=False,
                download_name='concatenated.pdf'
            )
            
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)