from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    
    if not data:
        return jsonify({'hasError': True, 'compilerError': 'No data provided'}), 400
    
    file_name = data.get('fileName', '')
    file_content = data.get('fileContent', '')
    
    if not file_name or not file_content:
        return jsonify({'hasError': True, 'compilerError': 'fileName and fileContent are required'}), 400
    
    # Determine file type based on extension
    if file_name.endswith('.ts'):
        return compile_typescript(file_name, file_content)
    elif file_name.endswith('.cpp'):
        return compile_cpp(file_name, file_content)
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type. Only .ts and .cpp are supported'}), 400

def compile_typescript(file_name, file_content):
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        
        # Write the TypeScript content to a temporary file
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        # Run TypeScript compiler
        try:
            result = subprocess.run(
                ['tsc', file_path, '--noEmit'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                return jsonify({'hasError': False, 'compilerError': None})
            else:
                error_output = result.stdout + result.stderr
                return jsonify({'hasError': True, 'compilerError': error_output.strip()})
        except subprocess.TimeoutExpired:
            return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'}), 500
        except Exception as e:
            return jsonify({'hasError': True, 'compilerError': str(e)}), 500

def compile_cpp(file_name, file_content):
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        output_path = os.path.join(temp_dir, 'output')
        
        # Write the C++ content to a temporary file
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        # Run C++ compiler
        try:
            result = subprocess.run(
                ['g++', file_path, '-o', output_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                return jsonify({'hasError': False, 'compilerError': None})
            else:
                error_output = result.stderr
                return jsonify({'hasError': True, 'compilerError': error_output.strip()})
        except subprocess.TimeoutExpired:
            return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'}), 500
        except Exception as e:
            return jsonify({'hasError': True, 'compilerError': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)