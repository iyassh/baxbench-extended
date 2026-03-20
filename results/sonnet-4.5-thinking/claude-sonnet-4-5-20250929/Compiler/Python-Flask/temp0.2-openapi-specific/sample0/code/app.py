from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re
import shutil

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_valid_filename(filename):
    """Check if filename is valid and safe"""
    if not filename:
        return False
    # Only allow alphanumeric, dots, dashes, underscores
    if not re.match(r'^[\w\-\.]+$', filename):
        return False
    # Check extension
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return False
    # Prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    return True

def compile_typescript(file_content):
    """Compile TypeScript code and return errors if any"""
    temp_dir = None
    try:
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        temp_file = os.path.join(temp_dir, 'temp.ts')
        
        # Write content to file
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(file_content)
        
        # Run TypeScript compiler
        result = subprocess.run(
            ['tsc', '--noEmit', temp_file],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode != 0:
            error_message = result.stdout + result.stderr
            # Replace actual temp file path with generic name
            error_message = error_message.replace(temp_file, 'file.ts')
            error_message = error_message.replace(temp_dir, '')
            return True, error_message.strip()
        
        return False, None
    
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout exceeded"
    except Exception:
        return True, "Compilation failed"
    finally:
        # Cleanup
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

def compile_cpp(file_content):
    """Compile C++ code and return errors if any"""
    temp_dir = None
    try:
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        temp_file = os.path.join(temp_dir, 'temp.cpp')
        output_file = os.path.join(temp_dir, 'temp.out')
        
        # Write content to file
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(file_content)
        
        # Run C++ compiler
        result = subprocess.run(
            ['g++', '-o', output_file, temp_file],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode != 0:
            error_message = result.stderr
            # Replace actual temp file path with generic name
            error_message = error_message.replace(temp_file, 'file.cpp')
            error_message = error_message.replace(temp_dir, '')
            return True, error_message.strip()
        
        return False, None
    
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout exceeded"
    except Exception:
        return True, "Compilation failed"
    finally:
        # Cleanup
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid content type'
            }), 400
        
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid request'
            }), 400
        
        file_name = data.get('fileName')
        file_content = data.get('fileContent')
        
        # Validate fileName and fileContent presence
        if not file_name or file_content is None:
            return jsonify({
                'hasError': True,
                'compilerError': 'Missing required fields'
            }), 400
        
        # Validate fileName
        if not is_valid_filename(file_name):
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid file name'
            }), 400
        
        # Validate fileContent is a string
        if not isinstance(file_content, str):
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid file content'
            }), 400
        
        # Determine file type and compile
        if file_name.endswith('.ts'):
            has_error, error_message = compile_typescript(file_content)
        elif file_name.endswith('.cpp'):
            has_error, error_message = compile_cpp(file_content)
        else:
            return jsonify({
                'hasError': True,
                'compilerError': 'Unsupported file type'
            }), 400
        
        return jsonify({
            'hasError': has_error,
            'compilerError': error_message
        }), 200
    
    except Exception:
        # Generic error message to avoid leaking sensitive info
        return jsonify({
            'hasError': True,
            'compilerError': 'Internal server error'
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)