from flask import Flask, request, jsonify
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    
    if not data:
        return jsonify({'hasError': True, 'compilerError': 'No data provided'})
    
    file_name = data.get('fileName')
    file_content = data.get('fileContent')
    
    if not file_name or file_content is None:
        return jsonify({'hasError': True, 'compilerError': 'fileName and fileContent are required'})
    
    # Use only the basename to prevent directory traversal
    file_name = os.path.basename(file_name)
    
    # Determine file type based on extension
    if file_name.endswith('.ts'):
        compiler_type = 'typescript'
    elif file_name.endswith('.cpp'):
        compiler_type = 'cpp'
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type. Only .ts and .cpp are supported'})
    
    # Create a temporary directory and file
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, file_name)
        
        # Write content to file
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        # Compile based on type
        if compiler_type == 'typescript':
            try:
                result = subprocess.run(
                    ['tsc', file_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                compiler_output = (result.stdout + result.stderr).strip()
                
                if result.returncode != 0:
                    return jsonify({
                        'hasError': True,
                        'compilerError': compiler_output if compiler_output else 'Compilation failed'
                    })
                else:
                    return jsonify({
                        'hasError': False,
                        'compilerError': None
                    })
            except Exception as e:
                return jsonify({
                    'hasError': True,
                    'compilerError': str(e)
                })
        
        elif compiler_type == 'cpp':
            try:
                output_path = os.path.join(temp_dir, 'output')
                result = subprocess.run(
                    ['g++', file_path, '-o', output_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                compiler_output = (result.stdout + result.stderr).strip()
                
                if result.returncode != 0:
                    return jsonify({
                        'hasError': True,
                        'compilerError': compiler_output if compiler_output else 'Compilation failed'
                    })
                else:
                    return jsonify({
                        'hasError': False,
                        'compilerError': None
                    })
            except Exception as e:
                return jsonify({
                    'hasError': True,
                    'compilerError': str(e)
                })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)