import os
import subprocess
import tempfile
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'.ts', '.cpp', '.cc', '.cxx'}

def is_safe_filename(filename):
    """Validate filename to prevent path traversal and other attacks."""
    if not filename:
        return False
    # Only allow alphanumeric, dots, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9_\-]+\.(ts|cpp|cc|cxx)$', filename):
        return False
    # Prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    return True

def get_extension(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower()

def compile_typescript(file_path, filename):
    """Compile a TypeScript file and return (hasError, compilerError)."""
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
            error_output = result.stdout + result.stderr
            # Replace temp path with original filename
            error_output = error_output.replace(file_path, filename)
            return True, error_output.strip()
    except subprocess.TimeoutExpired:
        return True, "Compilation timed out."
    except Exception as e:
        return True, f"Compilation error: {str(e)}"

def compile_cpp(file_path, filename):
    """Compile a C++ file and return (hasError, compilerError)."""
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
            error_output = result.stdout + result.stderr
            # Replace temp path with original filename
            error_output = error_output.replace(file_path, filename)
            return True, error_output.strip()
    except subprocess.TimeoutExpired:
        return True, "Compilation timed out."
    except Exception as e:
        return True, f"Compilation error: {str(e)}"

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    
    if not data:
        return jsonify({'hasError': True, 'compilerError': 'Invalid JSON body.'}), 400
    
    filename = data.get('fileName', '')
    file_content = data.get('fileContent', '')
    
    if not filename:
        return jsonify({'hasError': True, 'compilerError': 'fileName is required.'}), 400
    
    if not is_safe_filename(filename):
        return jsonify({'hasError': True, 'compilerError': 'Invalid fileName. Only .ts, .cpp, .cc, .cxx extensions with alphanumeric names are allowed.'}), 400
    
    ext = get_extension(filename)
    
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({'hasError': True, 'compilerError': f'Unsupported file extension: {ext}. Supported: .ts, .cpp, .cc, .cxx'}), 400
    
    if not isinstance(file_content, str):
        return jsonify({'hasError': True, 'compilerError': 'fileContent must be a string.'}), 400
    
    # Write content to a temporary file
    try:
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix=ext,
            delete=False,
            prefix='compile_'
        ) as tmp_file:
            tmp_file.write(file_content)
            tmp_path = tmp_file.name
        
        try:
            if ext == '.ts':
                has_error, compiler_error = compile_typescript(tmp_path, filename)
            else:  # .cpp, .cc, .cxx
                has_error, compiler_error = compile_cpp(tmp_path, filename)
        finally:
            # Always clean up the temp file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        
        return jsonify({
            'hasError': has_error,
            'compilerError': compiler_error
        }), 200
    
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'Server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)