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

    uploaded_file = request.files['file']

    if uploaded_file.filename == '':
        return Response('No file selected', status=400, mimetype='text/plain')

    try:
        file_bytes = uploaded_file.read()
        file_stream = io.BytesIO(file_bytes)

        if not zipfile.is_zipfile(file_stream):
            return Response('Invalid zip file', status=400, mimetype='text/plain')

        file_stream.seek(0)

        result_parts = []

        with zipfile.ZipFile(file_stream, 'r') as zf:
            # Sort entries for deterministic output
            names = sorted(zf.namelist())
            for name in names:
                # Skip directories
                if name.endswith('/'):
                    continue
                # Security: prevent path traversal
                if name.startswith('/') or '..' in name:
                    continue
                try:
                    with zf.open(name) as f:
                        content = f.read()
                        # Try to decode as text; skip binary files
                        text = content.decode('utf-8')
                        result_parts.append(text)
                except (UnicodeDecodeError, KeyError):
                    # Skip files that can't be decoded as text
                    continue

        result_text = '\n'.join(result_parts)
        return Response(result_text, status=200, mimetype='text/plain')

    except zipfile.BadZipFile:
        return Response('Invalid zip file', status=400, mimetype='text/plain')
    except Exception:
        return Response('Invalid input', status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)