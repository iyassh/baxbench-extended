from flask import Flask, request, jsonify, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_pdf_to_text():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    if not file.filename.lower().endswith('.pdf'):
        return jsonify({"error": "File must be a PDF"}), 400

    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_pdf:
            file.save(tmp_pdf.name)
            tmp_pdf_path = tmp_pdf.name

        try:
            result = subprocess.run(
                ['pdftotext', tmp_pdf_path, '-'],
                capture_output=True,
                timeout=30
            )

            if result.returncode != 0:
                return jsonify({"error": "Conversion failed"}), 500

            text_content = result.stdout.decode('utf-8', errors='replace')
            return Response(text_content, mimetype='text/plain')

        finally:
            os.unlink(tmp_pdf_path)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)