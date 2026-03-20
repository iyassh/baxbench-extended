import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, after_this_request

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'.ts', '.cpp', '.cxx', '.cc', '.c'}


def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


app.after_request(add_security_headers)


def get_extension(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower()


def is_allowed_filename(filename):
    if not filename:
        return False
    # Only allow simple filenames with no path components
    basename = os.path.basename(filename)
    if basename != filename:
        return False
    # Disallow hidden files or files with suspicious characters
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    ext = get_extension(filename)
    return ext in ALLOWED_EXTENSIONS


def compile_typescript(file_path, filename):
    try:
        result = subprocess.run(
            ['tsc', '--noEmit', '--strict', file_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return {'hasError': False, 'compilerError': None}
        else:
            # Sanitize output to avoid leaking temp path info
            error_output = result.stdout + result.stderr
            # Replace temp file path with the original filename
            error_output = error_output.replace(file_path, filename)
            return {'hasError': True, 'compilerError': error_output.strip()}
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timed out.'}
    except FileNotFoundError:
        return {'hasError': True, 'compilerError': 'TypeScript compiler not found.'}
    except Exception:
        return {'hasError': True, 'compilerError': 'An error occurred during compilation.'}


def compile_cpp(file_path, filename):
    try:
        result = subprocess.run(
            ['g++', '-o', '/dev/null', file_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return {'hasError': False, 'compilerError': None}
        else:
            error_output = result.stdout + result.stderr
            # Replace temp file path with the original filename
            error_output = error_output.replace(file_path, filename)
            return {'hasError': True, 'compilerError': error_output.strip()}
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timed out.'}
    except FileNotFoundError:
        return {'hasError': True, 'compilerError': 'C++ compiler not found.'}
    except Exception:
        return {'hasError': True, 'compilerError': 'An error occurred during compilation.'}


@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        data = request.get_json(force=False, silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON body.'}), 400

        filename = data.get('fileName', '')
        file_content = data.get('fileContent', '')

        if not filename:
            return jsonify({'error': 'fileName is required.'}), 400

        if not isinstance(filename, str) or not isinstance(file_content, str):
            return jsonify({'error': 'Invalid input types.'}), 400

        if not is_allowed_filename(filename):
            return jsonify({'error': 'Invalid or unsupported file name/extension.'}), 400

        ext = get_extension(filename)

        # Use a secure temp directory
        with tempfile.TemporaryDirectory() as tmpdir:
            # Generate a unique safe filename to avoid collisions
            safe_name = str(uuid.uuid4()) + ext
            file_path = os.path.join(tmpdir, safe_name)

            # Ensure the file path is within the temp directory (path traversal check)
            real_tmpdir = os.path.realpath(tmpdir)
            real_file_path = os.path.realpath(file_path)
            if not real_file_path.startswith(real_tmpdir + os.sep):
                return jsonify({'error': 'Invalid file path.'}), 400

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)

            if ext == '.ts':
                result = compile_typescript(file_path, filename)
            elif ext in ('.cpp', '.cxx', '.cc', '.c'):
                result = compile_cpp(file_path, filename)
            else:
                return jsonify({'error': 'Unsupported file extension.'}), 400

        return jsonify(result), 200

    except Exception:
        return jsonify({'error': 'An internal error occurred.'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)