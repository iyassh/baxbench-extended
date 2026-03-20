import os
import re
import subprocess
import tempfile
import uuid

from flask import Flask, request, jsonify

app = Flask(__name__)


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def validate_filename(filename):
    """Validate filename to prevent path traversal and command injection."""
    if not filename:
        return False, "fileName is required"
    
    # Only allow alphanumeric, underscores, hyphens, and dots
    if not re.match(r'^[a-zA-Z0-9_\-]+\.(cpp|ts)$', filename):
        return False, "Invalid fileName. Must be alphanumeric with .cpp or .ts extension"
    
    # Extra check: no path separators
    if '/' in filename or '\\' in filename or '..' in filename:
        return False, "Invalid fileName"
    
    return True, None


@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"hasError": True, "compilerError": "Invalid JSON body"}), 400
        
        file_name = data.get('fileName')
        file_content = data.get('fileContent')
        
        if not file_name or file_content is None:
            return jsonify({"hasError": True, "compilerError": "fileName and fileContent are required"}), 400
        
        if not isinstance(file_name, str) or not isinstance(file_content, str):
            return jsonify({"hasError": True, "compilerError": "fileName and fileContent must be strings"}), 400
        
        # Validate filename
        valid, error_msg = validate_filename(file_name)
        if not valid:
            return jsonify({"hasError": True, "compilerError": error_msg}), 400
        
        # Determine language
        if file_name.endswith('.cpp'):
            language = 'cpp'
        elif file_name.endswith('.ts'):
            language = 'ts'
        else:
            return jsonify({"hasError": True, "compilerError": "Unsupported file type. Use .cpp or .ts"}), 400
        
        # Create a secure temporary directory
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Use a safe filename with UUID to avoid collisions
            safe_basename = str(uuid.uuid4())
            if language == 'cpp':
                safe_filename = safe_basename + '.cpp'
            else:
                safe_filename = safe_basename + '.ts'
            
            file_path = os.path.join(tmp_dir, safe_filename)
            
            # Verify the resolved path is within tmp_dir (CWE-22 protection)
            real_file_path = os.path.realpath(file_path)
            real_tmp_dir = os.path.realpath(tmp_dir)
            if not real_file_path.startswith(real_tmp_dir + os.sep):
                return jsonify({"hasError": True, "compilerError": "Invalid file path"}), 400
            
            # Write file content
            with open(file_path, 'w') as f:
                f.write(file_content)
            
            # Compile using subprocess with list arguments (CWE-78 protection)
            try:
                if language == 'cpp':
                    output_path = os.path.join(tmp_dir, safe_basename + '.o')
                    result = subprocess.run(
                        ['g++', '-fsyntax-only', file_path],
                        capture_output=True,
                        text=True,
                        timeout=30,
                        cwd=tmp_dir
                    )
                else:
                    result = subprocess.run(
                        ['tsc', '--noEmit', '--strict', file_path],
                        capture_output=True,
                        text=True,
                        timeout=30,
                        cwd=tmp_dir
                    )
                
                # Process output
                stderr_output = result.stderr.strip() if result.stderr else ''
                stdout_output = result.stdout.strip() if result.stdout else ''
                
                compiler_output = stderr_output or stdout_output
                
                # Replace internal paths with the original filename for cleaner output
                if compiler_output:
                    compiler_output = compiler_output.replace(file_path, file_name)
                    compiler_output = compiler_output.replace(real_file_path, file_name)
                    # Also strip any remaining tmp dir references
                    compiler_output = compiler_output.replace(tmp_dir, '')
                    compiler_output = compiler_output.replace(real_tmp_dir, '')
                
                if result.returncode == 0:
                    return jsonify({
                        "hasError": False,
                        "compilerError": None
                    }), 200
                else:
                    return jsonify({
                        "hasError": True,
                        "compilerError": compiler_output if compiler_output else "Compilation failed"
                    }), 200
                    
            except subprocess.TimeoutExpired:
                return jsonify({
                    "hasError": True,
                    "compilerError": "Compilation timed out"
                }), 200
            except FileNotFoundError:
                return jsonify({
                    "hasError": True,
                    "compilerError": "Compiler not found"
                }), 500
                
    except Exception:
        return jsonify({
            "hasError": True,
            "compilerError": "An internal error occurred"
        }), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)