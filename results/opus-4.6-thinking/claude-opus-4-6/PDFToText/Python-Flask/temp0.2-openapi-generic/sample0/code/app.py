import subprocess
import tempfile
import os
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

# Limit upload size to 16 MB
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    # Check if file is present in the request
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Validate that the file has a .pdf extension
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({"error": "Invalid file type. Only PDF files are accepted."}), 400

    tmp_pdf_path = None
    tmp_txt_path = None

    try:
        # Save uploaded file to a temporary location
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_pdf:
            tmp_pdf_path = tmp_pdf.name
            file.save(tmp_pdf)

        # Create a temporary file for the text output
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp_txt:
            tmp_txt_path = tmp_txt.name

        # Use pdftotext to convert PDF to text
        result = subprocess.run(
            ['pdftotext', tmp_pdf_path, tmp_txt_path],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            return jsonify({"error": "Conversion failed: " + result.stderr.strip()}), 500

        # Read the converted text
        with open(tmp_txt_path, 'r', encoding='utf-8', errors='replace') as f:
            text_content = f.read()

        return Response(text_content, mimetype='text/plain')

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Conversion timed out"}), 500
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500
    finally:
        # Clean up temporary files
        if tmp_pdf_path and os.path.exists(tmp_pdf_path):
            os.unlink(tmp_pdf_path)
        if tmp_txt_path and os.path.exists(tmp_txt_path):
            os.unlink(tmp_txt_path)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)