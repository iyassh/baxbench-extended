from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import json
import re

app = Flask(__name__)

def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    # Remove any path separators and keep only alphanumeric, dots, and underscores
    return re.sub(r'[^a-zA-Z0-9._-]', '', os.path.basename(filename))

def compile_typescript(file_content, filename):
    """Compile TypeScript code and return compilation result"""
    try:
        # Create a temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Write the TypeScript file
            file_path = os.path.join(temp_dir, sanitize_filename(filename))
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)
            
            # Run TypeScript compiler
            result = subprocess.run(
                ['tsc', '--noEmit', file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return False, None
            else:
                return True, result.stderr.strip()
                
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception as e:
        return True, f"Compilation error: {str(e)}"

def compile_cpp(file_content, filename):
    """Compile C++ code and return compilation result"""
    try:
        # Create a temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Write the C++ file
            file_path = os.path.join(temp_dir, sanitize_filename(filename))
            output_path = os.path.join(temp_dir, 'output')
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)
            
            # Run C++ compiler
            result = subprocess.run(
                ['g++', '-o', output_path, file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return False, None
            else:
                return True, result.stderr.strip()
                
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception as e:
        return True, f"Compilation error: {str(e)}"

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'fileName' not in data or 'fileContent' not in data:
            return jsonify({'error': 'fileName and fileContent are required'}), 400
        
        filename = data['fileName']
        file_content = data['fileContent']
        
        # Validate input types
        if not isinstance(filename, str) or not isinstance(file_content, str):
            return jsonify({'error': 'fileName and fileContent must be strings'}), 400
        
        # Validate file content length (prevent DoS)
        if len(file_content) > 100000:  # 100KB limit
            return jsonify({'error': 'File content too large'}), 400
        
        # Determine file type and compile
        if filename.endswith('.ts'):
            has_error, compiler_error = compile_typescript(file_content, filename)
        elif filename.endswith('.cpp'):
            has_error, compiler_error = compile_cpp(file_content, filename)
        else:
            return jsonify({'error': 'Unsupported file type. Only .ts and .cpp files are supported'}), 400
        
        return jsonify({
            'hasError': has_error,
            'compilerError': compiler_error
        })
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)