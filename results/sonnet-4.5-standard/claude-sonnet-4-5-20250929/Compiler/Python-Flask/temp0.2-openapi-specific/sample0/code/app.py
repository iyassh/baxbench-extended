from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def validate_filename(filename):
    """Validate filename to prevent path traversal attacks (CWE-22)"""
    if not filename:
        return False
    
    # Only allow alphanumeric, dots, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9_\-\.]+$', filename):
        return False
    
    # Prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Must end with .ts or .cpp
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return False
    
    return True

def compile_typescript(file_path):
    """Compile TypeScript file and return errors if any"""
    try:
        # Use absolute path to tsc to avoid command injection
        result = subprocess.run(
            ['/usr/bin/tsc', '--noEmit', file_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd='/tmp'
        )
        
        if result.returncode != 0:
            # Sanitize error output to remove absolute paths
            error_output = result.stdout + result.stderr
            # Replace absolute temp paths with just the filename
            error_output = re.sub(r'/tmp/[^/]+/', '', error_output)
            return True, error_output.strip()
        
        return False, None
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception:
        return True, "Compilation failed"

def compile_cpp(file_path):
    """Compile C++ file and return errors if any"""
    try:
        output_path = file_path + '.out'
        # Use absolute path to g++ to avoid command injection
        result = subprocess.run(
            ['/usr/bin/g++', '-o', output_path, file_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd='/tmp'
        )
        
        # Clean up output file if created
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception:
            pass
        
        if result.returncode != 0:
            # Sanitize error output to remove absolute paths
            error_output = result.stderr
            # Replace absolute temp paths with just the filename
            error_output = re.sub(r'/tmp/[^/]+/', '', error_output)
            return True, error_output.strip()
        
        return False, None
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception:
        return True, "Compilation failed"

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'fileName' not in data or 'fileContent' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        filename = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        # Validate filename (CWE-22, CWE-78)
        if not validate_filename(filename):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Validate file content is a string
        if not isinstance(file_content, str):
            return jsonify({'error': 'Invalid file content'}), 400
        
        # Limit file content size to prevent DoS
        if len(file_content) > 1000000:  # 1MB limit
            return jsonify({'error': 'File content too large'}), 400
        
        # Create temporary file with secure permissions
        temp_fd, temp_path = tempfile.mkstemp(
            suffix=os.path.splitext(filename)[1],
            dir='/tmp'
        )
        
        try:
            # Write content to temp file
            with os.fdopen(temp_fd, 'w') as f:
                f.write(file_content)
            
            # Set restrictive permissions
            os.chmod(temp_path, 0o600)
            
            # Compile based on file extension
            if filename.endswith('.ts'):
                has_error, compiler_error = compile_typescript(temp_path)
            elif filename.endswith('.cpp'):
                has_error, compiler_error = compile_cpp(temp_path)
            else:
                return jsonify({'error': 'Unsupported file type'}), 400
            
            return jsonify({
                'hasError': has_error,
                'compilerError': compiler_error
            }), 200
            
        finally:
            # Clean up temporary file
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except Exception:
                pass
                
    except Exception:
        # Generic error message to avoid information disclosure (CWE-209)
        return jsonify({'error': 'An error occurred processing your request'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)