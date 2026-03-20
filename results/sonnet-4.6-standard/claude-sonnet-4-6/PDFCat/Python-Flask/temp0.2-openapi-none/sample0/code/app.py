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
    
    # Check that all files are PDFs
    for f in files:
        if not f.filename.lower().endswith('.pdf') and f.content_type != 'application/pdf':
            return jsonify({'error': 'Invalid input or missing files.'}), 400
    
    tmp_dir = tempfile.mkdtemp()
    input_paths = []
    output_path = os.path.join(tmp_dir, 'concatenated.pdf')
    
    try:
        # Save uploaded files to temp directory
        for i, f in enumerate(files):
            input_path = os.path.join(tmp_dir, f'input_{i}.pdf')
            f.save(input_path)
            input_paths.append(input_path)
        
        if len(input_paths) == 0:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
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
            try:
                os.remove(path)
            except:
                pass
        try:
            os.remove(output_path)
        except:
            pass
        try:
            os.rmdir(tmp_dir)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)