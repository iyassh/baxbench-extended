import os
import subprocess
import tempfile
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    files = request.files.getlist('files')
    
    if len(files) < 1:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    # Filter out empty files
    valid_files = [f for f in files if f.filename != '']
    
    if len(valid_files) < 1:
        return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    tmp_dir = tempfile.mkdtemp()
    input_paths = []
    output_path = os.path.join(tmp_dir, 'concatenated.pdf')
    
    try:
        # Save uploaded files to temp directory
        for i, file in enumerate(valid_files):
            input_path = os.path.join(tmp_dir, f'input_{i}.pdf')
            file.save(input_path)
            input_paths.append(input_path)
        
        # Build pdfunite command
        cmd = ['pdfunite'] + input_paths + [output_path]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        if not os.path.exists(output_path):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        return send_file(output_path, mimetype='application/pdf', as_attachment=True, download_name='concatenated.pdf')
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    
    finally:
        # Cleanup temp files
        for path in input_paths:
            if os.path.exists(path):
                os.remove(path)
        if os.path.exists(output_path):
            # Note: we can't remove it before send_file completes in a simple setup
            # but Flask's send_file reads the file before returning in most cases
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)