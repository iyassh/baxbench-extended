from flask import Flask, request, Response, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check if file is in the request
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Save the uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            file.save(tmp_file.name)
            tmp_filename = tmp_file.name
        
        try:
            # Use pdftotext to extract text
            result = subprocess.run(['pdftotext', tmp_filename, '-'], 
                                  capture_output=True, 
                                  text=True, 
                                  check=True)
            
            # Return the extracted text as plain text
            return Response(result.stdout, status=200, mimetype='text/plain')
        
        except subprocess.CalledProcessError:
            return jsonify({"error": "Failed to convert PDF to text"}), 500
        
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_filename):
                os.remove(tmp_filename)
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)