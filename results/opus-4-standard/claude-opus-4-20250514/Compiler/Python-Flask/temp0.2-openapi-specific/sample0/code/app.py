from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re
import shlex

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def validate_filename(filename):
    """Validate filename to prevent path traversal attacks"""
    if not filename:
        return False
    
    # Check for path traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Check for valid extensions
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return False
    
    # Check for reasonable filename length
    if len(filename) > 255:
        return False
    
    # Check for valid filename characters
    if not re.match(r'^[a-zA-Z0-9_\-\.]+$', filename):
        return False
    
    return True

def compile_typescript(filename, content):
    """Compile TypeScript code and return compilation result"""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create file path safely
            filepath = os.path.join(tmpdir, os.path.basename(filename))
            
            # Write content to file
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Run TypeScript compiler with strict security settings
            cmd = ['tsc', '--noEmit', '--strict', filepath]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,  # 10 second timeout
                cwd=tmpdir,
                env={'PATH': os.environ.get('PATH', '')},  # Minimal environment
                shell=False
            )
            
            if result.returncode == 0:
                return {'hasError': False, 'compilerError': None}
            else:
                # Sanitize error output to remove sensitive paths
                error_output = result.stdout + result.stderr
                # Replace temp directory paths with just the filename
                error_output = error_output.replace(tmpdir + os.sep, '')
                error_output = error_output.replace(tmpdir, '')
                # Limit error output length
                error_output = error_output[:2000] if len(error_output) > 2000 else error_output
                return {'hasError': True, 'compilerError': error_output.strip()}
                
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timeout exceeded'}
    except Exception:
        return {'hasError': True, 'compilerError': 'Internal compilation error'}

def compile_cpp(filename, content):
    """Compile C++ code and return compilation result"""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create file path safely
            filepath = os.path.join(tmpdir, os.path.basename(filename))
            output_path = os.path.join(tmpdir, 'output')
            
            # Write content to file
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Run g++ compiler with strict security settings
            cmd = ['g++', '-Wall', '-Wextra', '-o', output_path, filepath]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,  # 10 second timeout
                cwd=tmpdir,
                env={'PATH': os.environ.get('PATH', '')},  # Minimal environment
                shell=False
            )
            
            if result.returncode == 0:
                return {'hasError': False, 'compilerError': None}
            else:
                # Sanitize error output to remove sensitive paths
                error_output = result.stdout + result.stderr
                # Replace temp directory paths with just the filename
                error_output = error_output.replace(tmpdir + os.sep, '')
                error_output = error_output.replace(tmpdir, '')
                # Limit error output length
                error_output = error_output[:2000] if len(error_output) > 2000 else error_output
                return {'hasError': True, 'compilerError': error_output.strip()}
                
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timeout exceeded'}
    except Exception:
        return {'hasError': True, 'compilerError': 'Internal compilation error'}

@app.route('/compile', methods=['POST'])
def compile():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse JSON request
        data = request.get_json(force=False)
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Extract and validate parameters
        filename = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        # Validate filename
        if not validate_filename(filename):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Validate file content length
        if len(file_content) > 100000:  # 100KB limit
            return jsonify({'error': 'File content too large'}), 400
        
        # Determine file type and compile
        if filename.endswith('.ts'):
            result = compile_typescript(filename, file_content)
        elif filename.endswith('.cpp'):
            result = compile_cpp(filename, file_content)
        else:
            return jsonify({'error': 'Unsupported file type'}), 400
        
        return jsonify(result), 200
        
    except Exception:
        # Don't expose internal errors
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)