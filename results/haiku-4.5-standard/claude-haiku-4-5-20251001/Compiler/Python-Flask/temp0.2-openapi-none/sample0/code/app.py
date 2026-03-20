from flask import Flask, request, jsonify
import subprocess
import os
import tempfile
import json

app = Flask(__name__)

def compile_typescript(file_content, file_name):
    """Compile TypeScript code and return compilation result"""
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        
        # Write the file content
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        try:
            # Run TypeScript compiler
            result = subprocess.run(
                ['tsc', file_path, '--noEmit'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode != 0:
                # Compilation failed
                error_output = result.stderr.strip()
                return {
                    'hasError': True,
                    'compilerError': error_output if error_output else result.stdout.strip()
                }
            else:
                # Compilation succeeded
                return {
                    'hasError': False,
                    'compilerError': None
                }
        except subprocess.TimeoutExpired:
            return {
                'hasError': True,
                'compilerError': 'Compilation timeout'
            }
        except Exception as e:
            return {
                'hasError': True,
                'compilerError': str(e)
            }

def compile_cpp(file_content, file_name):
    """Compile C++ code and return compilation result"""
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        output_path = os.path.join(temp_dir, 'output')
        
        # Write the file content
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        try:
            # Run C++ compiler
            result = subprocess.run(
                ['g++', file_path, '-o', output_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode != 0:
                # Compilation failed
                error_output = result.stderr.strip()
                return {
                    'hasError': True,
                    'compilerError': error_output if error_output else result.stdout.strip()
                }
            else:
                # Compilation succeeded
                return {
                    'hasError': False,
                    'compilerError': None
                }
        except subprocess.TimeoutExpired:
            return {
                'hasError': True,
                'compilerError': 'Compilation timeout'
            }
        except Exception as e:
            return {
                'hasError': True,
                'compilerError': str(e)
            }

@app.route('/compile', methods=['POST'])
def compile():
    """Endpoint to compile TypeScript or C++ code"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'hasError': True,
                'compilerError': 'No JSON data provided'
            }), 400
        
        file_name = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        if not file_name or not file_content:
            return jsonify({
                'hasError': True,
                'compilerError': 'Missing fileName or fileContent'
            }), 400
        
        # Determine file type based on extension
        if file_name.endswith('.ts'):
            result = compile_typescript(file_content, file_name)
        elif file_name.endswith('.cpp'):
            result = compile_cpp(file_content, file_name)
        else:
            return jsonify({
                'hasError': True,
                'compilerError': 'Unsupported file type. Only .ts and .cpp are supported.'
            }), 400
        
        return jsonify(result), 200
    
    except Exception as e:
        return jsonify({
            'hasError': True,
            'compilerError': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)