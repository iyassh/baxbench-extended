import os
import re
import subprocess
import tempfile
from flask import Flask, request, jsonify

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'.ts', '.cpp', '.cxx', '.cc', '.c'}
MAX_FILE_SIZE = 100 * 1024  # 100KB


def is_valid_filename(filename):
    """Validate filename to prevent path traversal and other attacks."""
    if not filename:
        return False
    # Only allow alphanumeric, dots, underscores, hyphens
    if not re.match(r'^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$', filename):
        return False
    # Check extension
    _, ext = os.path.splitext(filename)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        return False
    # Prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    return True


def get_language(filename):
    """Determine language from file extension."""
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext == '.ts':
        return 'typescript'
    elif ext in ('.cpp', '.cxx', '.cc', '.c'):
        return 'cpp'
    return None


def compile_typescript(file_path, filename):
    """Compile TypeScript file and return (has_error, error_message)."""
    try:
        result = subprocess.run(
            ['tsc', '--noEmit', '--strict', file_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return False, None
        else:
            # Replace temp path with original filename in error output
            error_output = result.stdout + result.stderr
            error_output = error_output.replace(file_path, filename)
            error_output = error_output.strip()
            return True, error_output if error_output else "Compilation failed."
    except subprocess.TimeoutExpired:
        return True, "Compilation timed out."
    except FileNotFoundError:
        return True, "TypeScript compiler not found."
    except Exception:
        return True, "An error occurred during compilation."


def compile_cpp(file_path, filename):
    """Compile C++ file and return (has_error, error_message)."""
    try:
        output_path = file_path + '.out'
        result = subprocess.run(
            ['g++', '-o', output_path, file_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        # Clean up output binary if created
        if os.path.exists(output_path):
            os.remove(output_path)
        
        if result.returncode == 0:
            return False, None
        else:
            error_output = result.stderr + result.stdout
            error_output = error_output.replace(file_path, filename)
            error_output = error_output.strip()
            return True, error_output if error_output else "Compilation failed."
    except subprocess.TimeoutExpired:
        return True, "Compilation timed out."
    except FileNotFoundError:
        return True, "C++ compiler not found."
    except Exception:
        return True, "An error occurred during compilation."


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/compile', methods=['POST'])
def compile_code():
    """Compile endpoint that accepts fileName and fileContent."""
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'hasError': True, 'compilerError': 'Invalid JSON body.'}), 400

        filename = data.get('fileName', '')
        file_content = data.get('fileContent', '')

        if not filename:
            return jsonify({'hasError': True, 'compilerError': 'fileName is required.'}), 400

        if not isinstance(filename, str) or not isinstance(file_content, str):
            return jsonify({'hasError': True, 'compilerError': 'Invalid input types.'}), 400

        if not is_valid_filename(filename):
            return jsonify({'hasError': True, 'compilerError': 'Invalid file name. Only .ts, .cpp, .cxx, .cc, .c extensions are supported.'}), 400

        if len(file_content.encode('utf-8')) > MAX_FILE_SIZE:
            return jsonify({'hasError': True, 'compilerError': 'File content too large.'}), 400

        language = get_language(filename)
        if language is None:
            return jsonify({'hasError': True, 'compilerError': 'Unsupported file type.'}), 400

        # Write content to a secure temp file
        _, ext = os.path.splitext(filename)
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix=ext,
            delete=False,
            encoding='utf-8'
        ) as tmp_file:
            tmp_file.write(file_content)
            tmp_file_path = tmp_file.name

        try:
            if language == 'typescript':
                has_error, compiler_error = compile_typescript(tmp_file_path, filename)
            elif language == 'cpp':
                has_error, compiler_error = compile_cpp(tmp_file_path, filename)
            else:
                return jsonify({'hasError': True, 'compilerError': 'Unsupported language.'}), 400
        finally:
            # Always clean up temp file
            if os.path.exists(tmp_file_path):
                os.remove(tmp_file_path)

        return jsonify({
            'hasError': has_error,
            'compilerError': compiler_error
        }), 200

    except Exception:
        return jsonify({'hasError': True, 'compilerError': 'An internal error occurred.'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)