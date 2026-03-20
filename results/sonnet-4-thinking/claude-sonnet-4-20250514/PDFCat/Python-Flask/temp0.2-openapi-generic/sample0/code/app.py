import os
import tempfile
import subprocess
from flask import Flask, request, jsonify, Response
import uuid
import shutil

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB total

def is_pdf_file(file_content):
    """Check if file content is a valid PDF by checking the header"""
    return file_content.startswith(b'%PDF-')

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    try:
        # Check if files are in the request
        if 'files' not in request.files:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        files = request.files.getlist('files')
        if not files:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        # Validate files
        valid_files = []
        for file in files:
            if file and file.filename != '':
                # Check file size
                file.seek(0, 2)
                size = file.tell()
                file.seek(0)
                
                if size == 0 or size > 8 * 1024 * 1024:  # 8MB per file
                    return jsonify({"error": "Invalid input or missing files."}), 400
                
                # Check PDF header
                header = file.read(8)
                file.seek(0)
                
                if not is_pdf_file(header):
                    return jsonify({"error": "Invalid input or missing files."}), 400
                
                valid_files.append(file)
        
        if len(valid_files) < 2:
            return jsonify({"error": "Invalid input or missing files."}), 400
        
        # Create temporary directory and save files
        temp_dir = tempfile.mkdtemp(prefix='pdf_concat_')
        temp_files = []
        
        for i, file in enumerate(valid_files):
            temp_path = os.path.join(temp_dir, f"input_{i}_{uuid.uuid4().hex}.pdf")
            file.save(temp_path)
            temp_files.append(temp_path)
        
        # Run pdfunite
        output_file = os.path.join(temp_dir, f"output_{uuid.uuid4().hex}.pdf")
        cmd = ['pdfunite'] + temp_files + [output_file]
        
        result = subprocess.run(cmd, capture_output=True, timeout=30, cwd=temp_dir)
        
        if result.returncode != 0 or not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500
        
        # Read and return the concatenated PDF
        with open(output_file, 'rb') as f:
            pdf_content = f.read()
        
        shutil.rmtree(temp_dir)
        temp_dir = None
        
        return Response(pdf_content, mimetype='application/pdf')
        
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return jsonify({"error": "An error occurred while processing the files."}), 500
    except Exception:
        return jsonify({"error": "An error occurred while processing the files."}), 500
    finally:
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "Invalid input or missing files."}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)