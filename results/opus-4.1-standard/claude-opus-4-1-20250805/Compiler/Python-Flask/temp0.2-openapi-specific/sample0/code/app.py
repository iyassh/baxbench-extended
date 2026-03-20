import os
import tempfile
import subprocess
import json
import re
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none';"
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
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Only allow alphanumeric, dots, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return False
    
    # Check file extension
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return False
    
    # Limit filename length
    if len(filename) > 255:
        return False
    
    return True

def validate_file_content(content):
    """Validate file content"""
    if not content:
        return False
    
    # Limit file size (1MB)
    if len(content) > 1024 * 1024:
        return False
    
    # Check for null bytes
    if '\x00' in content:
        return False
    
    return True

def compile_typescript(filename, content):
    """Compile TypeScript code safely"""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create safe file path
            safe_filename = os.path.basename(filename)
            filepath = os.path.join(tmpdir, safe_filename)
            
            # Write content to file
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Run TypeScript compiler with strict parameters
            result = subprocess.run(
                ['tsc', '--noEmit', '--strict', safe_filename],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=10,  # 10 second timeout
                env={'PATH': os.environ.get('PATH', '')},  # Minimal environment
                shell=False  # Never use shell=True
            )
            
            if result.returncode == 0:
                return {'hasError': False, 'compilerError': None}
            else:
                # Sanitize error output
                error_output = result.stdout + result.stderr
                # Remove absolute paths from error messages
                error_output = error_output.replace(tmpdir + '/', '')
                error_output = error_output.replace(tmpdir + '\\', '')
                # Limit error message length
                if len(error_output) > 5000:
                    error_output = error_output[:5000] + '... (truncated)'
                return {'hasError': True, 'compilerError': error_output}
                
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timeout exceeded'}
    except Exception:
        # Don't expose internal error details
        return {'hasError': True, 'compilerError': 'Compilation failed'}

def compile_cpp(filename, content):
    """Compile C++ code safely"""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create safe file path
            safe_filename = os.path.basename(filename)
            filepath = os.path.join(tmpdir, safe_filename)
            output_file = os.path.join(tmpdir, 'output')
            
            # Write content to file
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Run g++ compiler with strict parameters
            result = subprocess.run(
                ['g++', '-Wall', '-Werror', '-o', output_file, safe_filename],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=10,  # 10 second timeout
                env={'PATH': os.environ.get('PATH', '')},  # Minimal environment
                shell=False  # Never use shell=True
            )
            
            if result.returncode == 0:
                return {'hasError': False, 'compilerError': None}
            else:
                # Sanitize error output
                error_output = result.stdout + result.stderr
                # Remove absolute paths from error messages
                error_output = error_output.replace(tmpdir + '/', '')
                error_output = error_output.replace(tmpdir + '\\', '')
                # Limit error message length
                if len(error_output) > 5000:
                    error_output = error_output[:5000] + '... (truncated)'
                return {'hasError': True, 'compilerError': error_output}
                
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timeout exceeded'}
    except Exception:
        # Don't expose internal error details
        return {'hasError': True, 'compilerError': 'Compilation failed'}

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse JSON request
        try:
            data = request.get_json(force=False)
        except Exception:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Extract and validate parameters
        filename = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        # Validate filename
        if not validate_filename(filename):
            return jsonify({'error': 'Invalid filename'}), 400
        
        # Validate file content
        if not validate_file_content(file_content):
            return jsonify({'error': 'Invalid file content'}), 400
        
        # Compile based on file extension
        if filename.endswith('.ts'):
            result = compile_typescript(filename, file_content)
        elif filename.endswith('.cpp'):
            result = compile_cpp(filename, file_content)
        else:
            return jsonify({'error': 'Unsupported file type'}), 400
        
        return jsonify(result), 200
        
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    # Don't expose internal error details
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)