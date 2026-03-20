from flask import Flask, request, Response, jsonify
import os
import tempfile
import subprocess
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate():
    try:
        # Get all files with the name 'files'
        files = request.files.getlist('files')
        
        # Check if files were provided
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Filter out empty files
        valid_files = [f for f in files if f and f.filename != '']
        
        if not valid_files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_file_paths = []
            
            # Save all uploaded files to temporary directory
            for i, file in enumerate(valid_files):
                # Create a safe filename
                filename = secure_filename(file.filename) if file.filename else f'file_{i}.pdf'
                if not filename.endswith('.pdf'):
                    filename = f'{filename}.pdf'
                
                temp_path = os.path.join(temp_dir, f'input_{i}_{filename}')
                file.save(temp_path)
                temp_file_paths.append(temp_path)
            
            # Path for the output file
            output_path = os.path.join(temp_dir, 'concatenated.pdf')
            
            # Construct the pdfunite command
            cmd = ['pdfunite'] + temp_file_paths + [output_path]
            
            # Execute pdfunite command
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            
            if result.returncode != 0:
                # Log the error for debugging (in production you might want to log this properly)
                print(f"pdfunite error: {result.stderr}")
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Read the concatenated PDF
            with open(output_path, 'rb') as f:
                pdf_data = f.read()
            
            # Return the PDF file
            return Response(
                pdf_data,
                mimetype='application/pdf',
                headers={'Content-Disposition': 'attachment; filename=concatenated.pdf'}
            )
            
    except Exception as e:
        # Log the exception for debugging
        print(f"Exception occurred: {str(e)}")
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)