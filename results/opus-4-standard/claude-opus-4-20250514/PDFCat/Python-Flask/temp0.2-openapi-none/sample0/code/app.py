from flask import Flask, request, send_file, jsonify
import os
import tempfile
import subprocess
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    try:
        # Check if files were uploaded
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that files were provided
        if not files or len(files) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory to store uploaded files
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_paths = []
            
            # Save uploaded files to temporary directory
            for idx, file in enumerate(files):
                if file.filename == '':
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Validate file extension
                if not file.filename.lower().endswith('.pdf'):
                    return jsonify({'error': 'Invalid input or missing files.'}), 400
                
                # Save file with secure filename
                filename = secure_filename(f"pdf_{idx}_{file.filename}")
                filepath = os.path.join(temp_dir, filename)
                file.save(filepath)
                pdf_paths.append(filepath)
            
            # Create output file path
            output_path = os.path.join(temp_dir, 'concatenated.pdf')
            
            # Build pdfunite command
            cmd = ['pdfunite'] + pdf_paths + [output_path]
            
            # Execute pdfunite command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Check if command was successful
            if result.returncode != 0:
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
    app.run(host='0.0.0.0', port=5000)