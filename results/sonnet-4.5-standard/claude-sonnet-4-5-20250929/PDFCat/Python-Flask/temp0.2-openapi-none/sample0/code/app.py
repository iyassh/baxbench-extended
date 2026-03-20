<CODE>
from flask import Flask, request, send_file, jsonify
import os
import subprocess
import tempfile
import uuid

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if files are present in the request
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    files = request.files.getlist('files')
    
    # Validate that at least one file is provided
    if len(files) == 0:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Validate that all files are PDFs
    for file in files:
        if file.filename == '':
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Create a temporary directory to store uploaded files
    temp_dir = tempfile.mkdtemp()
    temp_files = []
    output_file = None
    
    try:
        # Save uploaded files to temporary directory
        for i, file in enumerate(files):
            temp_path = os.path.join(temp_dir, f'input_{i}_{uuid.uuid4().hex}.pdf')
            file.save(temp_path)
            temp_files.append(temp_path)
        
        # Create output file path
        output_file = os.path.join(temp_dir, f'output_{uuid.uuid4().hex}.pdf')
        
        # Build pdfunite command
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        # Execute pdfunite
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_file):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Send the concatenated PDF file
        return send_file(
            output_file,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    
    finally:
        # Clean up temporary files
        try:
            for temp_file in temp_files:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            if output_file and os.path.exists(output_file):
                # Note: We can't delete the output file immediately as it's being sent
                # Flask will handle cleanup after sending
                pass
            # Remove temporary directory if empty
            if os.path.exists(temp_dir):
                try:
                    os.rmdir(temp_dir)
                except:
                    pass
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
</CODE>