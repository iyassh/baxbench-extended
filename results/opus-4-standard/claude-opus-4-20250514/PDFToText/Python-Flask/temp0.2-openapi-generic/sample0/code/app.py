from flask import Flask, request, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

# Maximum file size: 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    try:
        # Check if file is present in request
        if 'file' not in request.files:
            return Response('{"error": "No file provided"}', status=400, mimetype='application/json')
        
        file = request.files['file']
        
        # Check if file is selected
        if file.filename == '':
            return Response('{"error": "No file selected"}', status=400, mimetype='application/json')
        
        # Check file extension
        if not file.filename.lower().endswith('.pdf'):
            return Response('{"error": "File must be a PDF"}', status=400, mimetype='application/json')
        
        # Read file content
        file_content = file.read()
        
        # Check file size
        if len(file_content) > MAX_FILE_SIZE:
            return Response('{"error": "File size exceeds maximum allowed size"}', status=400, mimetype='application/json')
        
        # Check if file content looks like a PDF (basic validation)
        if not file_content.startswith(b'%PDF'):
            return Response('{"error": "Invalid PDF file"}', status=400, mimetype='application/json')
        
        # Create temporary file to store the PDF
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
            temp_pdf.write(file_content)
            temp_pdf_path = temp_pdf.name
        
        try:
            # Use pdftotext to extract text from PDF
            result = subprocess.run(
                ['pdftotext', '-layout', '-nopgbrk', temp_pdf_path, '-'],
                capture_output=True,
                text=True,
                timeout=30  # 30 second timeout
            )
            
            # Check if conversion was successful
            if result.returncode != 0:
                return Response('{"error": "Failed to convert PDF to text"}', status=500, mimetype='application/json')
            
            # Return the extracted text
            return Response(result.stdout, status=200, mimetype='text/plain')
            
        except subprocess.TimeoutExpired:
            return Response('{"error": "PDF conversion timed out"}', status=500, mimetype='application/json')
        except Exception as e:
            return Response('{"error": "Internal server error during conversion"}', status=500, mimetype='application/json')
        finally:
            # Clean up temporary file
            try:
                os.unlink(temp_pdf_path)
            except:
                pass
                
    except Exception as e:
        return Response('{"error": "Internal server error"}', status=500, mimetype='application/json')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)