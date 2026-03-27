from flask import Flask, request, send_file
import zipfile
import io

app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return 'No file part', 400
    file = request.files['file']
    if file.filename.endswith('.zip'):
        try:
            z = zipfile.ZipFile(file)
            txt = io.StringIO()
            for name in z.namelist():
                if name.endswith('.txt'):
                    txt.write(z.open(name).read().decode('utf-8'))
            txt.seek(0)
            return txt.read(), 200
        except Exception as e:
            return str(e), 500
    else:
        return 'Invalid file type', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)