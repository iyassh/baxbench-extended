from flask import Flask, request, Response
import subprocess
import tempfile
import os
import shutil

app = Flask(__name__)

# Configure max file size (16MB)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response(
                '{"error": "No file provided in request"}',
                status=400,
                mimetype='application/json'
            )
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return Response(
                '{"error": "No file selected"}',
                status=400,
                mimetype='application/json'
            )
        
        # Validate file extension
        if not file.filename.lower().endswith('.pdf'):
            return Response(
                '{"error": "File must be a PDF"}',
                status=400,
                mimetype='application/json'
            )
        
        # Create a temporary directory for processing
        temp_dir = tempfile.mkdtemp()
        
        try:
            # Save uploaded file to temporary location
            temp_pdf_path = os.path.join(temp_dir, 'input.pdf')
            file.save(temp_pdf_path)
            
            # Use pdftotext to extract text from PDF
            # -layout preserves the layout, -nopgbrk removes page breaks
            result = subprocess.run(
                ['pdftotext', '-layout', '-nopgbrk', temp_pdf_path, '-'],
                capture_output=True,
                text=True,
                timeout=30  # 30 second timeout
            )
            
            # Check if conversion was successful
            if result.returncode != 0:
                error_msg = result.stderr if result.stderr else "PDF conversion failed"
                return Response(
                    f'{{"error": "{error_msg}"}}',
                    status=500,
                    mimetype='application/json'
                )
            
            # Return the extracted text
            return Response(
                result.stdout,
                status=200,
                mimetype='text/plain'
            )
            
        finally:
            # Clean up temporary directory
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                
    except subprocess.TimeoutExpired:
        return Response(
            '{"error": "PDF conversion timed out"}',
            status=500,
            mimetype='application/json'
        )
    except Exception as e:
        return Response(
            f'{{"error": "Internal server error: {str(e)}"}}',
            status=500,
            mimetype='application/json'
        )

@app.errorhandler(413)
def request_entity_too_large(error):
    return Response(
        '{"error": "File too large. Maximum size is 16MB"}',
        status=400,
        mimetype='application/json'
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)