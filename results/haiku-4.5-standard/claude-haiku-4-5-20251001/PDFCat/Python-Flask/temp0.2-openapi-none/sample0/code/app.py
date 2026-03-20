import os
import subprocess
import tempfile
from flask import Flask, request, send_file, jsonify

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
        
        # Create a temporary directory to store uploaded files
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_file_paths = []
            
            # Save uploaded files to temporary directory
            for i, file in enumerate(files):
                if file.filename == '':
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Validate that the file is a PDF
                if not file.filename.lower().endswith('.pdf'):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                temp_file_path = os.path.join(temp_dir, f'temp_{i}.pdf')
                file.save(temp_file_path)
                temp_file_paths.append(temp_file_path)
            
            # Output file path
            output_file_path = os.path.join(temp_dir, 'concatenated.pdf')
            
            # Build the pdfunite command
            command = ['pdfunite'] + temp_file_paths + [output_file_path]
            
            # Execute pdfunite command
            result = subprocess.run(command, capture_output=True, text=True)
            
            if result.returncode != 0:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_file_path):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Send the concatenated PDF file
            return send_file(
                output_file_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name='concatenated.pdf'
            )
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)