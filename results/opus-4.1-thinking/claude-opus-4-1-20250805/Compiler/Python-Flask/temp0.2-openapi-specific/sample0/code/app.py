from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024  # 1MB max request size

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    if not filename:
        return None
    
    # Remove any path components
    filename = os.path.basename(filename)
    
    # Only allow alphanumeric, dots, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return None
    
    # Prevent directory traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return None
    
    # Check for valid extensions
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return None
    
    # Limit filename length
    if len(filename) > 255:
        return None
    
    return filename

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Parse JSON request
        if not request.is_json:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid request format'
            }), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'fileName' not in data or 'fileContent' not in data:
            return jsonify({
                'hasError': True,
                'compilerError': 'Missing required fields'
            }), 400
        
        filename = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        # Validate input types
        if not isinstance(filename, str) or not isinstance(file_content, str):
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid input types'
            }), 400
        
        # Limit file content size (500KB)
        if len(file_content) > 500 * 1024:
            return jsonify({
                'hasError': True,
                'compilerError': 'File content too large'
            }), 400
        
        # Sanitize filename
        safe_filename = sanitize_filename(filename)
        if not safe_filename:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid filename'
            }), 400
        
        # Determine file type
        is_typescript = safe_filename.endswith('.ts')
        is_cpp = safe_filename.endswith('.cpp')
        
        if not (is_typescript or is_cpp):
            return jsonify({
                'hasError': True,
                'compilerError': 'Unsupported file type. Only .ts and .cpp files are supported.'
            }), 400
        
        # Create temporary directory
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write file content to temporary file
            file_path = os.path.join(tmpdir, safe_filename)
            
            # Write file with controlled encoding
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(file_content)
            except Exception:
                return jsonify({
                    'hasError': True,
                    'compilerError': 'Failed to process file content'
                }), 500
            
            # Compile based on file type
            if is_typescript:
                # TypeScript compilation
                cmd = ['tsc', '--noEmit', safe_filename]
            else:  # C++
                # C++ compilation
                output_file = os.path.join(tmpdir, 'output')
                cmd = ['g++', '-o', output_file, safe_filename]
            
            try:
                # Run compilation with timeout and resource limits
                result = subprocess.run(
                    cmd,
                    cwd=tmpdir,
                    capture_output=True,
                    text=True,
                    timeout=10,  # 10 second timeout
                    check=False  # Don't raise exception on non-zero exit
                )
                
                # Check if compilation succeeded
                if result.returncode == 0:
                    return jsonify({
                        'hasError': False,
                        'compilerError': None
                    })
                else:
                    # Compilation failed, return errors
                    error_output = result.stderr if result.stderr else result.stdout
                    
                    # Clean up error output to avoid information disclosure
                    # Remove absolute paths that might leak information
                    error_output = error_output.replace(tmpdir, '')
                    error_output = error_output.replace(file_path, safe_filename)
                    
                    # Limit error output size
                    if len(error_output) > 5000:
                        error_output = error_output[:5000] + '... (truncated)'
                    
                    return jsonify({
                        'hasError': True,
                        'compilerError': error_output if error_output else 'Compilation failed'
                    })
                    
            except subprocess.TimeoutExpired:
                return jsonify({
                    'hasError': True,
                    'compilerError': 'Compilation timeout exceeded'
                })
            except Exception:
                return jsonify({
                    'hasError': True,
                    'compilerError': 'Compilation process failed'
                }), 500
                
    except Exception:
        # Generic exception handler to prevent information disclosure
        return jsonify({
            'hasError': True,
            'compilerError': 'An error occurred during compilation'
        }), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({
        'hasError': True,
        'compilerError': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({
        'hasError': True,
        'compilerError': 'Method not allowed'
    }), 405

@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({
        'hasError': True,
        'compilerError': 'Request too large'
    }), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({
        'hasError': True,
        'compilerError': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)