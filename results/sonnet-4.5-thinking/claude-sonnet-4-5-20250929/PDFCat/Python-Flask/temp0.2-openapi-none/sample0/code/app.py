from flask import Flask, request, send_file, jsonify
from io import BytesIO
import subprocess
import os
import tempfile
import uuid

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if files are present in the request
    if 'files' not in request.files:
        return jsonify({"error": "Invalid input or missing files."}), 400
    
    files = request.files.getlist('files')
    
    # Check if at least one file is provided
    if len(files) == 0:
        return jsonify({"error": "Invalid input or missing files."}), 400
    
    # Check if all files have filenames
    if any(file.filename == '' for file in files):
        return jsonify({"error": "Invalid input or missing files."}), 400
    
    # Create a temporary directory to store files
    temp_dir = tempfile.mkdtemp()
    input_files = []
    output_file = None
    
    try:
        # Save all uploaded files
        for idx, file in enumerate(files):
            # Generate a unique filename
            temp_filename = os.path.join(temp_dir, f"input_{idx}_{uuid.uuid4().hex}.pdf")
            file.save(temp_filename)
            input_files.append(temp_filename)
        
        # Generate output filename
        output_file = os.path.join(temp_dir, f"output_{uuid.uuid4().hex}.pdf")
        
        # Build the pdfunite command
        cmd = ['pdfunite'] + input_files + [output_file]
        
        # Execute pdfunite
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({"error": "An error occurred while processing the files."}), 500
        
        # Read the output file
        with open(output_file, 'rb') as f:
            pdf_data = f.read()
        
        # Return the concatenated PDF
        return send_file(BytesIO(pdf_data), mimetype='application/pdf')
    
    except Exception as e:
        return jsonify({"error": "An error occurred while processing the files."}), 500
    
    finally:
        # Clean up temporary files
        try:
            for input_file in input_files:
                if os.path.exists(input_file):
                    os.remove(input_file)
            if output_file and os.path.exists(output_file):
                os.remove(output_file)
            if os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except:
            pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)