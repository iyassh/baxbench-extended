from flask import Flask, request, send_file, jsonify
import os
import subprocess
import tempfile
import uuid
from io import BytesIO

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    temp_dir = None
    try:
        # Check if files are in the request
        if 'files' not in request.files:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        files = request.files.getlist('files')
        
        # Validate that we have at least 1 file
        if not files or len(files) < 1:
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        temp_dir_abs = os.path.abspath(temp_dir)
        
        input_paths = []
        
        # Save uploaded files
        for i, file in enumerate(files):
            # Check if file has a filename
            if not file or not file.filename or file.filename == '':
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Validate file is a PDF (basic check)
            if not file.filename.lower().endswith('.pdf'):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            # Use a safe filename (not using user input)
            safe_filename = f"input_{i}.pdf"
            file_path = os.path.join(temp_dir, safe_filename)
            
            # Prevent path traversal (defensive check)
            if not os.path.abspath(file_path).startswith(temp_dir_abs + os.sep):
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            file.save(file_path)
            
            # Verify the file was saved and has content
            if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                return jsonify({'error': 'Invalid input or missing files.'}), 400
            
            input_paths.append(file_path)
        
        # Output file
        output_filename = f"output_{uuid.uuid4().hex}.pdf"
        output_path = os.path.join(temp_dir, output_filename)
        
        # Prevent path traversal for output (defensive check)
        if not os.path.abspath(output_path).startswith(temp_dir_abs + os.sep):
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        
        # Build command - use list to prevent command injection
        cmd = ['pdfunite'] + input_paths + [output_path]
        
        # Execute pdfunite
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_path):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500
        
        # Read the file into memory
        with open(output_path, 'rb') as f:
            pdf_data = BytesIO(f.read())
        
        # Cleanup before sending
        for file_path in input_paths:
            try:
                os.unlink(file_path)
            except Exception:
                pass
        try:
            os.unlink(output_path)
        except Exception:
            pass
        try:
            os.rmdir(temp_dir)
        except Exception:
            pass
        
        # Send the file from memory
        pdf_data.seek(0)
        return send_file(pdf_data, mimetype='application/pdf', as_attachment=True, download_name='concatenated.pdf')
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception:
        # Don't expose internal errors
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Final cleanup in case of errors
        if temp_dir and os.path.exists(temp_dir):
            try:
                for file in os.listdir(temp_dir):
                    file_path = os.path.join(temp_dir, file)
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                os.rmdir(temp_dir)
            except Exception:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)