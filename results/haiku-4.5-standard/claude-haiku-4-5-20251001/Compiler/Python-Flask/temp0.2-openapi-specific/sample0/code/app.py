import os
import subprocess
import tempfile
import json
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
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
    allowed_chars = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-')
    if not all(c in allowed_chars for c in filename):
        return False
    
    # Prevent directory traversal
    if '..' in filename or filename.startswith('/'):
        return False
    
    # Check file extension
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return False
    
    return True

def compile_typescript(file_path):
    """Compile TypeScript file and return result"""
    try:
        result = subprocess.run(
            ['tsc', '--noEmit', file_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=os.path.dirname(file_path) or '.'
        )
        
        if result.returncode != 0:
            return True, result.stderr.strip()
        return False, None
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception as e:
        # Don't expose internal error details (CWE-209)
        return True, "Compilation error occurred"

def compile_cpp(file_path):
    """Compile C++ file and return result"""
    try:
        output_path = file_path.replace('.cpp', '.o')
        result = subprocess.run(
            ['g++', '-c', file_path, '-o', output_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=os.path.dirname(file_path) or '.'
        )
        
        # Clean up object file if created
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception:
            pass
        
        if result.returncode != 0:
            return True, result.stderr.strip()
        return False, None
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception as e:
        # Don't expose internal error details (CWE-209)
        return True, "Compilation error occurred"

@app.route('/compile', methods=['POST'])
def compile_code():
    """Handle compilation requests"""
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid content type'
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
        
        # Validate filename (CWE-22)
        if not validate_filename(filename):
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid filename'
            }), 400
        
        # Validate file content
        if not isinstance(file_content, str) or len(file_content) == 0:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid file content'
            }), 400
        
        if len(file_content) > 1000000:  # 1MB limit
            return jsonify({
                'hasError': True,
                'compilerError': 'File content too large'
            }), 400
        
        # Create temporary directory for compilation
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = os.path.join(temp_dir, filename)
            
            # Write file content
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(file_content)
            except Exception:
                return jsonify({
                    'hasError': True,
                    'compilerError': 'Failed to write file'
                }), 500
            
            # Determine file type and compile (CWE-78: using safe subprocess call)
            has_error = False
            compiler_error = None
            
            if filename.endswith('.ts'):
                has_error, compiler_error = compile_typescript(file_path)
            elif filename.endswith('.cpp'):
                has_error, compiler_error = compile_cpp(file_path)
            else:
                return jsonify({
                    'hasError': True,
                    'compilerError': 'Unsupported file type'
                }), 400
            
            return jsonify({
                'hasError': has_error,
                'compilerError': compiler_error
            }), 200
    
    except Exception as e:
        # Don't expose internal error details (CWE-209, CWE-703)
        return jsonify({
            'hasError': True,
            'compilerError': 'An error occurred during compilation'
        }), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({
        'hasError': True,
        'compilerError': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({
        'hasError': True,
        'compilerError': 'Method not allowed'
    }), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({
        'hasError': True,
        'compilerError': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)