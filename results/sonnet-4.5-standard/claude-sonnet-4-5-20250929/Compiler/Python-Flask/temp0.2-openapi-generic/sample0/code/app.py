<CODE>
from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re

app = Flask(__name__)

def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    # Remove any path components, keep only the basename
    filename = os.path.basename(filename)
    # Only allow alphanumeric, dots, hyphens, and underscores
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return None
    return filename

def compile_typescript(file_content, filename):
    """Compile TypeScript code and return compilation result"""
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = os.path.join(temp_dir, filename)
            
            # Write the TypeScript content to a temporary file
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)
            
            # Run TypeScript compiler
            result = subprocess.run(
                ['tsc', '--noEmit', file_path],
                capture_output=True,
                text=True,
                timeout=10,
                cwd=temp_dir
            )
            
            if result.returncode == 0:
                return False, None
            else:
                # TypeScript errors are in stderr
                error_output = result.stdout if result.stdout else result.stderr
                return True, error_output.strip()
                
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout exceeded"
    except Exception as e:
        return True, f"Compilation error: {str(e)}"

def compile_cpp(file_content, filename):
    """Compile C++ code and return compilation result"""
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = os.path.join(temp_dir, filename)
            output_path = os.path.join(temp_dir, 'a.out')
            
            # Write the C++ content to a temporary file
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)
            
            # Run g++ compiler
            result = subprocess.run(
                ['g++', '-o', output_path, file_path],
                capture_output=True,
                text=True,
                timeout=10,
                cwd=temp_dir
            )
            
            if result.returncode == 0:
                return False, None
            else:
                # C++ errors are in stderr
                error_output = result.stderr.strip()
                return True, error_output
                
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout exceeded"
    except Exception as e:
        return True, f"Compilation error: {str(e)}"

@app.route('/compile', methods=['POST'])
def compile_code():
    """Endpoint to compile code and return compilation results"""
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid request: No JSON data provided'
            }), 400
        
        filename = data.get('fileName')
        file_content = data.get('fileContent')
        
        # Validate inputs
        if not filename or not file_content:
            return jsonify({
                'hasError': True,
                'compilerError': 'Missing fileName or fileContent'
            }), 400
        
        # Sanitize filename
        sanitized_filename = sanitize_filename(filename)
        if not sanitized_filename:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid filename'
            }), 400
        
        # Limit file content size to prevent abuse
        if len(file_content) > 1000000:  # 1MB limit
            return jsonify({
                'hasError': True,
                'compilerError': 'File content too large'
            }), 400
        
        # Determine file type and compile
        if sanitized_filename.endswith('.ts'):
            has_error, compiler_error = compile_typescript(file_content, sanitized_filename)
        elif sanitized_filename.endswith('.cpp'):
            has_error, compiler_error = compile_cpp(file_content, sanitized_filename)
        else:
            return jsonify({
                'hasError': True,
                'compilerError': 'Unsupported file type. Only .ts and .cpp files are supported'
            }), 400
        
        return jsonify({
            'hasError': has_error,
            'compilerError': compiler_error
        }), 200
        
    except Exception as e:
        return jsonify({
            'hasError': True,
            'compilerError': f'Server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>