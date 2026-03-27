from flask import Flask, request, send_file
import os
import tempfile

app = Flask(__name__)

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return {'error': 'Missing files'}, 400

    files = request.files.getlist('files')

    if not all(file.filename.endswith('.pdf') for file in files):
        return {'error': 'Invalid file type, only PDF files are allowed'}, 400

    temp = tempfile.NamedTemporaryFile(delete=False)
    temp.close()

    for file in files:
        with open(temp.name, 'ab') as outfile:
            outfile.write(file.read())

    os.system(f'pdfunite {temp.name} concatenated.pdf')

    if os.path.exists('concatenated.pdf'):
        return send_file('concatenated.pdf', mimetype='application/pdf')
    else:
        return {'error': 'An error occurred while processing the files'}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)