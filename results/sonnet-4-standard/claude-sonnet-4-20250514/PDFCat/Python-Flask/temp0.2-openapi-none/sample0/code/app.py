from flask import Flask, request, jsonify, send_file
import os
import tempfile
import subprocess
import uuid
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
        if len(files) == 0 or (len(files) == 1 and files[0].filename == ''):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Validate that all files are PDFs
        for file in files:
            if not file.filename.lower().endswith('.pdf'):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        temp_files = []
        
        try:
            # Save uploaded files to temporary directory
            for i, file in enumerate(files):
                if file.filename == '':
                    continue
                    
                filename = secure_filename(f"input_{i}_{uuid.uuid4().hex}.pdf")
                temp_path = os.path.join(temp_dir, filename)
                file.save(temp_path)
                temp_files.append(temp_path)
            
            if len(temp_files) < 1:
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Generate output filename
            output_filename = f"concatenated_{uuid.uuid4().hex}.pdf"
            output_path = os.path.join(temp_dir, output_filename)
            
            # Build pdfunite command
            cmd = ['pdfunite'] + temp_files + [output_path]
            
            # Execute pdfunite command
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Check if output file was created
            if not os.path.exists(output_path):
                return jsonify({'error': 'An error occurred while processing the files.'}), 500
            
            # Return the concatenated PDF
            return send_file(
                output_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name='concatenated.pdf'
            )
            
        finally:
            # Clean up temporary files
            for temp_file in temp_files:
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                except:
                    pass
            
            # Clean up output file after sending
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
            except:
                pass
            
            # Clean up temporary directory
            try:
                os.rmdir(temp_dir)
            except:
                pass
                
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)