import os
import tempfile
import subprocess
import json
import re
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Security configurations
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024  # 1MB max file size
ALLOWED_EXTENSIONS = {'.ts', '.cpp', '.cc', '.cxx'}
MAX_FILENAME_LENGTH = 255
COMPILATION_TIMEOUT = 10  # seconds

def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    if not filename:
        return None
    
    # Remove any path components
    filename = os.path.basename(filename)
    
    # Check length
    if len(filename) > MAX_FILENAME_LENGTH:
        return None
    
    # Only allow alphanumeric, dots, dashes, and underscores
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return None
    
    # Check extension
    ext = os.path.splitext(filename)[1]
    if ext not in ALLOWED_EXTENSIONS:
        return None
    
    return filename

def compile_typescript(filepath):
    """Compile TypeScript file and return compilation result"""
    try:
        result = subprocess.run(
            ['tsc', '--noEmit', filepath],
            capture_output=True,
            text=True,
            timeout=COMPILATION_TIMEOUT,
            cwd=os.path.dirname(filepath)
        )
        
        if result.returncode == 0:
            return {'hasError': False, 'compilerError': None}
        else:
            # TypeScript errors are in stdout
            error_output = result.stdout.strip() if result.stdout else result.stderr.strip()
            return {'hasError': True, 'compilerError': error_output}
    
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timeout exceeded'}
    except Exception as e:
        return {'hasError': True, 'compilerError': f'Compilation failed: {str(e)}'}

def compile_cpp(filepath):
    """Compile C++ file and return compilation result"""
    try:
        # Create a temporary output file
        with tempfile.NamedTemporaryFile(suffix='.out', delete=False) as tmp_out:
            output_path = tmp_out.name
        
        try:
            result = subprocess.run(
                ['g++', '-Wall', '-Wextra', '-o', output_path, filepath],
                capture_output=True,
                text=True,
                timeout=COMPILATION_TIMEOUT,
                cwd=os.path.dirname(filepath)
            )
            
            if result.returncode == 0:
                return {'hasError': False, 'compilerError': None}
            else:
                error_output = result.stderr.strip() if result.stderr else result.stdout.strip()
                return {'hasError': True, 'compilerError': error_output}
        
        finally:
            # Clean up output file
            if os.path.exists(output_path):
                os.unlink(output_path)
    
    except subprocess.TimeoutExpired:
        return {'hasError': True, 'compilerError': 'Compilation timeout exceeded'}
    except Exception as e:
        return {'hasError': True, 'compilerError': f'Compilation failed: {str(e)}'}

@app.route('/compile', methods=['POST'])
def compile_code():
    """Compile the provided code and return compilation results"""
    
    # Validate content type
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    try:
        data = request.get_json()
    except Exception:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    # Validate required fields
    if not data or 'fileName' not in data or 'fileContent' not in data:
        return jsonify({'error': 'Missing required fields: fileName and fileContent'}), 400
    
    filename = data.get('fileName')
    file_content = data.get('fileContent')
    
    # Validate inputs
    if not isinstance(filename, str) or not isinstance(file_content, str):
        return jsonify({'error': 'fileName and fileContent must be strings'}), 400
    
    # Sanitize filename
    safe_filename = sanitize_filename(filename)
    if not safe_filename:
        return jsonify({'error': 'Invalid filename'}), 400
    
    # Check file content size
    if len(file_content) > 1024 * 1024:  # 1MB limit
        return jsonify({'error': 'File content too large'}), 400
    
    # Determine file type
    ext = os.path.splitext(safe_filename)[1]
    
    # Create temporary file with the code
    with tempfile.TemporaryDirectory() as tmpdir:
        filepath = os.path.join(tmpdir, safe_filename)
        
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(file_content)
        except Exception:
            return jsonify({'error': 'Failed to write temporary file'}), 500
        
        # Compile based on file extension
        if ext == '.ts':
            result = compile_typescript(filepath)
        elif ext in ['.cpp', '.cc', '.cxx']:
            result = compile_cpp(filepath)
        else:
            return jsonify({'error': 'Unsupported file type'}), 400
    
    return jsonify(result), 200

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)