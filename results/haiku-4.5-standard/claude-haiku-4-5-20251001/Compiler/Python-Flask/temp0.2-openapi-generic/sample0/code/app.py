import subprocess
import json
import os
import tempfile
from flask import Flask, request, jsonify

app = Flask(__name__)

def compile_typescript(file_content: str, file_name: str) -> tuple[bool, str | None]:
    """Compile TypeScript code and return (success, error_message)"""
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        try:
            result = subprocess.run(
                ['tsc', file_path, '--noEmit'],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode != 0:
                error_output = result.stderr.strip()
                return False, error_output if error_output else result.stdout.strip()
            
            return True, None
        except subprocess.TimeoutExpired:
            return False, "Compilation timeout"
        except Exception as e:
            return False, f"Compilation error: {str(e)}"

def compile_cpp(file_content: str, file_name: str) -> tuple[bool, str | None]:
    """Compile C++ code and return (success, error_message)"""
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        output_path = os.path.join(temp_dir, 'output')
        
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        try:
            result = subprocess.run(
                ['g++', file_path, '-o', output_path],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode != 0:
                error_output = result.stderr.strip()
                return False, error_output if error_output else result.stdout.strip()
            
            return True, None
        except subprocess.TimeoutExpired:
            return False, "Compilation timeout"
        except Exception as e:
            return False, f"Compilation error: {str(e)}"

@app.route('/compile', methods=['POST'])
def compile():
    """Compile TypeScript or C++ code"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid request: no JSON body provided'
            }), 400
        
        file_name = data.get('fileName', '').strip()
        file_content = data.get('fileContent', '').strip()
        
        if not file_name:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid request: fileName is required'
            }), 400
        
        if not file_content:
            return jsonify({
                'hasError': True,
                'compilerError': 'Invalid request: fileContent is required'
            }), 400
        
        if file_name.endswith('.ts'):
            success, error = compile_typescript(file_content, file_name)
        elif file_name.endswith('.cpp'):
            success, error = compile_cpp(file_content, file_name)
        else:
            return jsonify({
                'hasError': True,
                'compilerError': 'Unsupported file type. Only .ts and .cpp files are supported.'
            }), 400
        
        return jsonify({
            'hasError': not success,
            'compilerError': error
        }), 200
    
    except Exception as e:
        return jsonify({
            'hasError': True,
            'compilerError': f'Server error: {str(e)}'
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'hasError': True,
        'compilerError': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({
        'hasError': True,
        'compilerError': 'Method not allowed'
    }), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)