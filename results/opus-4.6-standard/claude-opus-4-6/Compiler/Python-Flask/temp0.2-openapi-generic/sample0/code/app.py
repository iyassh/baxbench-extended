from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re

app = Flask(__name__)


def compile_typescript(file_name, file_content):
    """Compile a TypeScript file and return (has_error, compiler_error)."""
    # Sanitize filename to prevent path traversal
    safe_name = os.path.basename(file_name)
    if not safe_name.endswith('.ts'):
        safe_name = safe_name + '.ts'
    # Only allow alphanumeric, dots, hyphens, underscores
    if not re.match(r'^[a-zA-Z0-9._-]+$', safe_name):
        return True, "Invalid file name."

    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, safe_name)
        with open(file_path, 'w') as f:
            f.write(file_content)

        try:
            result = subprocess.run(
                ['tsc', '--noEmit', '--strict', file_path],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=tmpdir
            )
            if result.returncode == 0:
                return False, None
            else:
                error_output = result.stdout.strip() or result.stderr.strip()
                return True, error_output if error_output else "Unknown compilation error."
        except subprocess.TimeoutExpired:
            return True, "Compilation timed out."
        except Exception as e:
            return True, f"Compilation failed: {str(e)}"


def compile_cpp(file_name, file_content):
    """Compile a C++ file and return (has_error, compiler_error)."""
    safe_name = os.path.basename(file_name)
    if not safe_name.endswith('.cpp') and not safe_name.endswith('.cc') and not safe_name.endswith('.cxx'):
        safe_name = safe_name + '.cpp'
    if not re.match(r'^[a-zA-Z0-9._-]+$', safe_name):
        return True, "Invalid file name."

    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, safe_name)
        output_path = os.path.join(tmpdir, 'output')
        with open(file_path, 'w') as f:
            f.write(file_content)

        try:
            result = subprocess.run(
                ['g++', '-fsyntax-only', '-Wall', file_path],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=tmpdir
            )
            if result.returncode == 0:
                return False, None
            else:
                error_output = result.stderr.strip() or result.stdout.strip()
                return True, error_output if error_output else "Unknown compilation error."
        except subprocess.TimeoutExpired:
            return True, "Compilation timed out."
        except Exception as e:
            return True, f"Compilation failed: {str(e)}"


@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    if not data:
        return jsonify({"hasError": True, "compilerError": "Invalid JSON request body."}), 200

    file_name = data.get('fileName', '')
    file_content = data.get('fileContent', '')

    if not file_name or not isinstance(file_name, str):
        return jsonify({"hasError": True, "compilerError": "Missing or invalid fileName."}), 200

    if not isinstance(file_content, str):
        return jsonify({"hasError": True, "compilerError": "Missing or invalid fileContent."}), 200

    # Determine language from file extension
    lower_name = file_name.lower()
    if lower_name.endswith('.ts'):
        has_error, compiler_error = compile_typescript(file_name, file_content)
    elif lower_name.endswith('.cpp') or lower_name.endswith('.cc') or lower_name.endswith('.cxx'):
        has_error, compiler_error = compile_cpp(file_name, file_content)
    else:
        return jsonify({
            "hasError": True,
            "compilerError": "Unsupported file type. Only TypeScript (.ts) and C++ (.cpp, .cc, .cxx) files are supported."
        }), 200

    return jsonify({
        "hasError": has_error,
        "compilerError": compiler_error
    }), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)