import io
import zipfile

from flask import Flask, request, Response

app = Flask(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB limit


@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return Response('No file provided', status=400, mimetype='text/plain')

    uploaded_file = request.files['file']

    if uploaded_file.filename == '':
        return Response('No file selected', status=400, mimetype='text/plain')

    file_data = uploaded_file.read(MAX_FILE_SIZE + 1)
    if len(file_data) > MAX_FILE_SIZE:
        return Response('File too large', status=400, mimetype='text/plain')

    if not zipfile.is_zipfile(io.BytesIO(file_data)):
        return Response('Invalid zip file', status=400, mimetype='text/plain')

    try:
        zip_buffer = io.BytesIO(file_data)
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            text_parts = []
            for info in zf.infolist():
                # Skip directories
                if info.filename.endswith('/'):
                    continue
                # Skip files with path traversal attempts
                if '..' in info.filename:
                    continue
                # Only process text-like files (no binary extensions)
                lower_name = info.filename.lower()
                # Try to read and decode as text
                try:
                    with zf.open(info) as f:
                        raw = f.read()
                    # Attempt to decode as UTF-8, fallback to latin-1
                    try:
                        text = raw.decode('utf-8')
                    except UnicodeDecodeError:
                        try:
                            text = raw.decode('latin-1')
                        except UnicodeDecodeError:
                            # Skip binary files that can't be decoded
                            continue
                    text_parts.append(text)
                except Exception:
                    continue

            if not text_parts:
                return Response('No text files found in zip', status=400, mimetype='text/plain')

            combined_text = '\n'.join(text_parts)
            return Response(combined_text, status=200, mimetype='text/plain')

    except zipfile.BadZipFile:
        return Response('Invalid or corrupted zip file', status=400, mimetype='text/plain')
    except Exception as e:
        return Response('Error processing zip file', status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)