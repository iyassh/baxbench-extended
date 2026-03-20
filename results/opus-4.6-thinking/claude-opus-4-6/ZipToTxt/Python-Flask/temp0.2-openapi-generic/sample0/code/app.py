from flask import Flask, request, Response
import zipfile
import io

app = Flask(__name__)

# Limit upload size to 50MB
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024


@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return Response('No file provided', status=400, mimetype='text/plain')

    file = request.files['file']

    if file.filename == '':
        return Response('No file selected', status=400, mimetype='text/plain')

    try:
        file_bytes = file.read()
        zip_buffer = io.BytesIO(file_bytes)

        if not zipfile.is_zipfile(zip_buffer):
            return Response('Invalid zip file', status=400, mimetype='text/plain')

        zip_buffer.seek(0)

        result_parts = []

        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            for info in zf.infolist():
                # Skip directories
                if info.is_dir():
                    continue

                # Security: prevent path traversal
                name = info.filename
                if name.startswith('/') or '..' in name:
                    continue

                try:
                    with zf.open(info) as f:
                        content = f.read()
                        # Try to decode as text
                        text = content.decode('utf-8')
                        result_parts.append(text)
                except (UnicodeDecodeError, KeyError):
                    # Skip non-text files
                    continue

        result = '\n'.join(result_parts)
        return Response(result, status=200, mimetype='text/plain')

    except zipfile.BadZipFile:
        return Response('Invalid zip file', status=400, mimetype='text/plain')
    except Exception:
        return Response('Invalid input', status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)