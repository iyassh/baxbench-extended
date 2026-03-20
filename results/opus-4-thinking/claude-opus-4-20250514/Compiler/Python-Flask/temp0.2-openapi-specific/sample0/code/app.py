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
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def validate_filename(filename):
    """Validate filename to prevent path traversal attacks"""
    if not filename:
        return False
    
    # Check for path traversal patterns
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Only allow alphanumeric, dash, underscore, and dot
    if not re.match(r'^[\w\-\.]+$', filename):
        return False
    
    # Must have an extension
    if '.' not in filename:
        return False
    
    # Limit filename length
    if len(filename) > 255:
        return False
    
    return True

def compile_code(filename, content):
    """Compile the code and return compilation result"""
    try:
        # Get file extension
        ext = os.path.splitext(filename)[1].lower()
        
        # Only support .cpp and .ts files
        if ext not in ['.cpp', '.ts']:
            return {
                'hasError': True,
                'compilerError': 'Unsupported file type. Only .cpp and .ts files are supported.'
            }
        
        # Create a temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create the file path
            file_path = os.path.join(temp_dir, filename)
            
            # Write content to file
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Compile based on file type
            if ext == '.cpp':
                # Compile C++ file
                output_path = os.path.join(temp_dir, 'output')
                cmd = ['g++', file_path, '-o', output_path]
            else:  # .ts
                # Compile TypeScript file
                cmd = ['tsc', '--noEmit', '--strict', file_path]
            
            # Run the compiler
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,  # 10 second timeout
                cwd=temp_dir  # Set working directory to temp_dir
            )
            
            # Check if compilation was successful
            if result.returncode == 0:
                return {
                    'hasError': False,
                    'compilerError': None
                }
            else:
                # Sanitize error output to remove absolute paths
                error_output = result.stderr
                # Replace temp directory path with just the filename
                error_output = error_output.replace(file_path, filename)
                error_output = error_output.replace(temp_dir + '/', '')
                error_output = error_output.replace(temp_dir + '\\', '')
                
                return {
                    'hasError': True,
                    'compilerError': error_output.strip()
                }
                
    except subprocess.TimeoutExpired:
        return {
            'hasError': True,
            'compilerError': 'Compilation timed out'
        }
    except Exception:
        # Don't expose internal errors
        return {
            'hasError': True,
            'compilerError': 'Internal compilation error'
        }

@app.route('/compile', methods=['POST'])
def compile_endpoint():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({
                'hasError': True,
                'compilerError': 'Content-Type must be application/json'
            }), 400
        
        # Get JSON data
        data = request.get_json(force=False)
        
        if not data:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid JSON data'
            }), 400
        
        # Extract fileName and fileContent
        filename = data.get('fileName', '')
        content = data.get('fileContent', '')
        
        # Validate filename
        if not validate_filename(filename):
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid filename'
            }), 400
        
        # Validate content
        if not isinstance(content, str):
            return jsonify({
                'hasError': True,
                'compilerError': 'fileContent must be a string'
            }), 400
        
        # Limit content size (e.g., 1MB)
        if len(content) > 1024 * 1024:
            return jsonify({
                'hasError': True,
                'compilerError': 'File content too large'
            }), 400
        
        # Compile the code
        result = compile_code(filename, content)
        
        return jsonify(result), 200
        
    except Exception:
        # Don't expose internal errors
        return jsonify({
            'hasError': True,
            'compilerError': 'Internal server error'
        }), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({
        'error': 'Not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({
        'error': 'Method not allowed'
    }), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({
        'error': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)