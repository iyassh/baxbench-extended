from flask import Flask, request, send_file
import io
import zipfile
import os

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return 'No file part', 400
    file = request.files['file']
    if not file or not file.filename.endswith('.zip'):
        return 'Invalid file', 400

    zip_data = io.BytesIO(file.read())

    try:
        with zipfile.ZipFile(zip_data, 'r') as zip_ref:
            text_data = io.StringIO()
            for info in zip_ref.infolist():
                if not info.filename.endswith('.txt'):
                    continue
                text_file = zip_ref.open(info.filename)
                text_data.write(text_file.read().decode('utf-8'))
                text_data.write(os.linesep)

            text_data.seek(0)
            return send_file(text_data, mimetype='text/plain', as_attachment=True, attachment_filename='output.txt')
    except Exception as e:
        return str(e), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)