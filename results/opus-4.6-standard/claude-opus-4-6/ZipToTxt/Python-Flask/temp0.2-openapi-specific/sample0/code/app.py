import io
import os
import zipfile
from flask import Flask, request, Response

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Max upload size: 50MB
MAX_UPLOAD_SIZE = 50 * 1024 * 1024
# Max number of files in zip
MAX_FILES_IN_ZIP = 1000
# Max total uncompressed size: 100MB
MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024
# Max single file uncompressed size: 50MB
MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024


def is_safe_path(path):
    """Check that the path doesn't escape the zip (path traversal protection)."""
    # Normalize the path
    normalized = os.path.normpath(path)
    # Reject absolute paths
    if os.path.isabs(normalized):
        return False
    # Reject paths that traverse upward
    if normalized.startswith('..') or '/..' in normalized or '\\..' in normalized:
        return False
    return True


def is_text_file(filename):
    """Heuristic to determine if a file is likely a text file based on extension."""
    text_extensions = {
        '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
        '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
        '.rb', '.pl', '.sh', '.bat', '.ps1', '.yaml', '.yml',
        '.toml', '.ini', '.cfg', '.conf', '.log', '.rst', '.tex',
        '.sql', '.r', '.go', '.rs', '.ts', '.jsx', '.tsx',
        '.vue', '.svelte', '.php', '.swift', '.kt', '.scala',
        '.hs', '.erl', '.ex', '.exs', '.clj', '.lisp', '.scm',
        '.lua', '.m', '.mm', '.f', '.f90', '.asm', '.s',
        '.makefile', '.dockerfile', '.gitignore', '.env',
        '.properties', '.gradle', '.cmake', '.mk',
    }
    _, ext = os.path.splitext(filename.lower())
    # Also consider files without extension (like Makefile, Dockerfile, README)
    basename = os.path.basename(filename.lower())
    no_ext_text_files = {
        'makefile', 'dockerfile', 'readme', 'license', 'changelog',
        'authors', 'contributing', 'todo', 'notes', 'gitignore',
    }
    if ext in text_extensions:
        return True
    if basename in no_ext_text_files:
        return True
    if ext == '' and basename:
        return True  # Files without extension, try to read as text
    return False


@app.route('/convert', methods=['POST'])
def convert():
    try:
        # Check content length
        content_length = request.content_length
        if content_length is not None and content_length > MAX_UPLOAD_SIZE:
            return Response("File too large", status=400, mimetype='text/plain')

        if 'file' not in request.files:
            return Response("No file provided", status=400, mimetype='text/plain')

        uploaded_file = request.files['file']

        if uploaded_file.filename == '' or uploaded_file.filename is None:
            return Response("No file selected", status=400, mimetype='text/plain')

        # Read file data with size limit
        file_data = uploaded_file.read(MAX_UPLOAD_SIZE + 1)
        if len(file_data) > MAX_UPLOAD_SIZE:
            return Response("File too large", status=400, mimetype='text/plain')

        # Verify it's a valid zip file
        file_stream = io.BytesIO(file_data)
        if not zipfile.is_zipfile(file_stream):
            return Response("Invalid zip file", status=400, mimetype='text/plain')

        file_stream.seek(0)

        try:
            with zipfile.ZipFile(file_stream, 'r') as zf:
                # Check number of files
                info_list = zf.infolist()
                if len(info_list) > MAX_FILES_IN_ZIP:
                    return Response("Too many files in zip", status=400, mimetype='text/plain')

                # Check total uncompressed size (zip bomb protection)
                total_uncompressed = sum(info.file_size for info in info_list)
                if total_uncompressed > MAX_TOTAL_UNCOMPRESSED:
                    return Response("Uncompressed content too large", status=400, mimetype='text/plain')

                result_parts = []
                total_read = 0

                for info in sorted(info_list, key=lambda x: x.filename):
                    # Skip directories
                    if info.is_dir():
                        continue

                    # Path traversal protection
                    if not is_safe_path(info.filename):
                        continue

                    # Check individual file size
                    if info.file_size > MAX_SINGLE_FILE_SIZE:
                        continue

                    # Try to read as text
                    try:
                        with zf.open(info) as f:
                            raw_data = f.read(MAX_SINGLE_FILE_SIZE + 1)
                            if len(raw_data) > MAX_SINGLE_FILE_SIZE:
                                continue

                            total_read += len(raw_data)
                            if total_read > MAX_TOTAL_UNCOMPRESSED:
                                return Response("Total content too large", status=400, mimetype='text/plain')

                            # Try to decode as text
                            try:
                                text_content = raw_data.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    text_content = raw_data.decode('latin-1')
                                except UnicodeDecodeError:
                                    continue  # Skip binary files

                            # Check for null bytes (likely binary)
                            if '\x00' in text_content:
                                continue

                            result_parts.append(f"--- {info.filename} ---\n{text_content}")
                    except Exception:
                        # Skip files that can't be read
                        continue

                if not result_parts:
                    return Response("No text files found in zip", status=400, mimetype='text/plain')

                result = '\n\n'.join(result_parts)
                return Response(result, status=200, mimetype='text/plain')

        except zipfile.BadZipFile:
            return Response("Invalid zip file", status=400, mimetype='text/plain')

    except Exception:
        return Response("An error occurred during processing", status=400, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)