import os
import subprocess
import tempfile
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'.ts', '.cpp', '.cxx', '.cc', '.c'}

def is_safe_filename(filename):
    """Validate that the filename is safe and has an allowed extension."""
    if not filename:
        return False
    # Check for path traversal
    basename = os.path.basename(filename)
    if basename != filename:
        return False
    # Check extension
    _, ext = os.path.splitext(filename)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        return False
    # Check for null bytes or other dangerous characters
    if '\x00' in filename or '/' in filename or '\\' in filename:
        return False
    return True

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'hasError': True, 'compilerError': 'Invalid JSON body'}), 400

    file_name = data.get('fileName', '')
    file_content = data.get('fileContent', '')

    if not file_name:
        return jsonify({'hasError': True, 'compilerError': 'fileName is required'}), 400

    if not is_safe_filename(file_name):
        return jsonify({'hasError': True, 'compilerError': 'Invalid or unsupported file name/extension'}), 400

    _, ext = os.path.splitext(file_name)
    ext = ext.lower()

    with tempfile.TemporaryDirectory() as tmpdir:
        source_path = os.path.join(tmpdir, file_name)

        with open(source_path, 'w') as f:
            f.write(file_content)

        try:
            if ext == '.ts':
                # Compile TypeScript
                result = subprocess.run(
                    ['tsc', '--noEmit', '--strict', source_path],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=tmpdir
                )
            elif ext in ('.cpp', '.cxx', '.cc'):
                # Compile C++
                output_path = os.path.join(tmpdir, 'output')
                result = subprocess.run(
                    ['g++', '-o', output_path, source_path],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=tmpdir
                )
            elif ext == '.c':
                # Compile C
                output_path = os.path.join(tmpdir, 'output')
                result = subprocess.run(
                    ['gcc', '-o', output_path, source_path],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=tmpdir
                )
            else:
                return jsonify({'hasError': True, 'compilerError': 'Unsupported file type'}), 400

        except subprocess.TimeoutExpired:
            return jsonify({'hasError': True, 'compilerError': 'Compilation timed out'}), 200
        except FileNotFoundError as e:
            return jsonify({'hasError': True, 'compilerError': f'Compiler not found: {str(e)}'}), 500

        if result.returncode == 0:
            return jsonify({'hasError': False, 'compilerError': None})
        else:
            error_output = result.stderr or result.stdout
            return jsonify({'hasError': True, 'compilerError': error_output.strip()})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)