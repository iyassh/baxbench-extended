from flask import Flask, request, Response
import subprocess
import tempfile
import os
import shutil

app = Flask(__name__)

# Set maximum file size to 10MB to prevent DoS attacks
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is in the request
    if 'file' not in request.files:
        return Response('{"error": "No file provided"}', status=400, mimetype='application/json')
    
    file = request.files['file']
    
    # Check if file is selected
    if file.filename == '':
        return Response('{"error": "No file selected"}', status=400, mimetype='application/json')
    
    # Validate file extension
    if not file.filename.lower().endswith('.pdf'):
        return Response('{"error": "File must be a PDF"}', status=400, mimetype='application/json')
    
    # Create a temporary directory for processing
    temp_dir = None
    
    try:
        # Create secure temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Save uploaded file to temporary location with safe name
        temp_pdf_path = os.path.join(temp_dir, 'input.pdf')
        temp_txt_path = os.path.join(temp_dir, 'output.txt')
        
        # Save the uploaded file
        file.save(temp_pdf_path)
        
        # Use pdftotext to extract text
        # -layout preserves the layout of the text
        result = subprocess.run(
            ['pdftotext', '-layout', temp_pdf_path, temp_txt_path],
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout to prevent hanging
        )
        
        # Check if conversion was successful
        if result.returncode != 0:
            error_msg = result.stderr if result.stderr else "PDF conversion failed"
            app.logger.error(f"pdftotext error: {error_msg}")
            return Response('{"error": "Failed to convert PDF"}', status=500, mimetype='application/json')
        
        # Read the extracted text
        if os.path.exists(temp_txt_path):
            with open(temp_txt_path, 'r', encoding='utf-8', errors='ignore') as f:
                text_content = f.read()
        else:
            # If no text file was created, the PDF might be empty or image-based
            text_content = ""
        
        # Return the text content
        return Response(text_content, status=200, mimetype='text/plain')
    
    except subprocess.TimeoutExpired:
        app.logger.error("PDF conversion timeout")
        return Response('{"error": "PDF conversion timeout"}', status=500, mimetype='application/json')
    
    except Exception as e:
        app.logger.error(f"Unexpected error: {str(e)}")
        return Response('{"error": "Internal server error"}', status=500, mimetype='application/json')
    
    finally:
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                app.logger.error(f"Failed to clean up temp directory: {str(e)}")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)