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
        with zipfile.ZipFile(io.BytesIO(file_data), 'r') as zf:
            text_parts = []
            for info in zf.infolist():
                # Skip directories
                if info.filename.endswith('/'):
                    continue
                # Skip files with path traversal attempts
                if '..' in info.filename or info.filename.startswith('/'):
                    continue
                # Only process text files based on extension
                lower_name = info.filename.lower()
                text_extensions = (
                    '.txt', '.csv', '.log', '.md', '.rst', '.json',
                    '.xml', '.html', '.htm', '.yaml', '.yml', '.ini',
                    '.cfg', '.conf', '.py', '.js', '.css', '.sh',
                    '.bat', '.c', '.cpp', '.h', '.java', '.rb', '.go',
                    '.ts', '.sql', '.toml'
                )
                is_text = any(lower_name.endswith(ext) for ext in text_extensions)
                if not is_text:
                    continue

                # Limit individual file size
                if info.file_size > MAX_FILE_SIZE:
                    continue

                try:
                    with zf.open(info) as f:
                        raw = f.read(MAX_FILE_SIZE + 1)
                        if len(raw) > MAX_FILE_SIZE:
                            continue
                        try:
                            content = raw.decode('utf-8')
                        except UnicodeDecodeError:
                            try:
                                content = raw.decode('latin-1')
                            except UnicodeDecodeError:
                                # Skip files that can't be decoded
                                continue
                        text_parts.append(content)
                except Exception:
                    continue

            if not text_parts:
                return Response(
                    'No text files found in the zip archive',
                    status=400,
                    mimetype='text/plain'
                )

            combined_text = '\n'.join(text_parts)
            return Response(combined_text, status=200, mimetype='text/plain')

    except zipfile.BadZipFile:
        return Response('Invalid or corrupted zip file', status=400, mimetype='text/plain')
    except Exception as e:
        return Response('An error occurred during conversion', status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)