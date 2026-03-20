import os
import re
import subprocess
import tempfile
import uuid

from flask import Flask, request, jsonify

app = Flask(__name__)

# Disable debug mode to avoid leaking sensitive information
app.config['DEBUG'] = False

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


def validate_filename(filename):
    """Validate filename to prevent path traversal and command injection."""
    if not filename or not isinstance(filename, str):
        return False
    
    # Only allow alphanumeric characters, underscores, hyphens, and a single dot for extension
    if not re.match(r'^[a-zA-Z0-9_\-]+\.(cpp|ts)$', filename):
        return False
    
    # Extra check: no path separators
    if '/' in filename or '\\' in filename or '..' in filename:
        return False
    
    return True


@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        data = request.get_json(force=False, silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        file_name = data.get('fileName')
        file_content = data.get('fileContent')
        
        if not file_name or not isinstance(file_name, str):
            return jsonify({"error": "fileName is required and must be a string"}), 400
        
        if file_content is None or not isinstance(file_content, str):
            return jsonify({"error": "fileContent is required and must be a string"}), 400
        
        # Validate filename
        if not validate_filename(file_name):
            return jsonify({"error": "Invalid fileName. Must be alphanumeric with .cpp or .ts extension"}), 400
        
        # Determine language
        if file_name.endswith('.cpp'):
            language = 'cpp'
        elif file_name.endswith('.ts'):
            language = 'ts'
        else:
            return jsonify({"error": "Unsupported file type. Only .cpp and .ts are supported"}), 400
        
        # Create a secure temporary directory
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Use a sanitized filename within the temp directory
            safe_filename = os.path.basename(file_name)
            file_path = os.path.join(tmp_dir, safe_filename)
            
            # Verify the resolved path is within tmp_dir (defense in depth against path traversal)
            real_tmp_dir = os.path.realpath(tmp_dir)
            real_file_path = os.path.realpath(file_path)
            if not real_file_path.startswith(real_tmp_dir + os.sep):
                return jsonify({"error": "Invalid file path"}), 400
            
            # Write file content
            with open(file_path, 'w') as f:
                f.write(file_content)
            
            # Compile based on language - use list form to prevent shell injection (CWE-78)
            if language == 'cpp':
                output_path = os.path.join(tmp_dir, 'output_' + uuid.uuid4().hex)
                cmd = ['g++', '-o', output_path, file_path]
            else:
                cmd = ['tsc', '--noEmit', file_path]
            
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=tmp_dir,
                    env={
                        'PATH': os.environ.get('PATH', '/usr/bin:/usr/local/bin'),
                        'HOME': tmp_dir,
                        'TMPDIR': tmp_dir
                    }
                )
            except subprocess.TimeoutExpired:
                return jsonify({
                    "hasError": True,
                    "compilerError": "Compilation timed out"
                }), 200
            except Exception:
                return jsonify({"error": "Compilation process failed"}), 500
            
            if result.returncode == 0:
                return jsonify({
                    "hasError": False,
                    "compilerError": None
                }), 200
            else:
                # Combine stderr and stdout for compiler errors
                compiler_error = result.stderr.strip() or result.stdout.strip() or "Unknown compilation error"
                
                # Sanitize: remove references to the temp directory path to avoid info leakage
                compiler_error = compiler_error.replace(tmp_dir + '/', '')
                compiler_error = compiler_error.replace(tmp_dir, '')
                
                return jsonify({
                    "hasError": True,
                    "compilerError": compiler_error
                }), 200
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)