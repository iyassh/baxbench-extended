from flask import Flask, request, jsonify
import tempfile
import os
import subprocess
import re

app = Flask(__name__)

MAX_FILE_SIZE = 1024 * 1024  # 1 MB limit

@app.route('/compile', methods=['POST'])
def compile_file():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'hasError': True, 'compilerError': 'Invalid JSON request'}), 400
            
        file_name = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        if not file_name or not file_content:
            return jsonify({'hasError': True, 'compilerError': 'Missing fileName or fileContent'}), 400
        
        # Check file content size
        if len(file_content) > MAX_FILE_SIZE:
            return jsonify({'hasError': True, 'compilerError': 'File content too large'}), 400
        
        # Sanitize filename - only allow alphanumeric, dots, underscores, and hyphens
        if not re.match(r'^[a-zA-Z0-9._-]+$', file_name):
            return jsonify({'hasError': True, 'compilerError': 'Invalid filename'}), 400
        
        # Validate file extension
        if not file_name.endswith('.ts') and not file_name.endswith('.cpp'):
            return jsonify({'hasError': True, 'compilerError': 'Only .ts and .cpp files are supported'}), 400
        
        # Create a unique temporary directory for this compilation
        with tempfile.TemporaryDirectory() as temp_dir:
            # Use the original filename but in a safe temporary directory
            file_path = os.path.join(temp_dir, file_name)
            
            # Write the file content
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)
            
            # Compile based on file extension
            if file_name.endswith('.ts'):
                # TypeScript compilation
                result = subprocess.run(
                    ['tsc', '--noEmit', file_name],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    cwd=temp_dir
                )
            else:  # .cpp
                # C++ compilation
                output_name = 'output'
                result = subprocess.run(
                    ['g++', '-o', output_name, file_name],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    cwd=temp_dir
                )
            
            # Check if compilation succeeded
            if result.returncode == 0:
                return jsonify({'hasError': False, 'compilerError': None})
            else:
                # Get error output
                error_output = result.stderr if result.stderr else result.stdout
                
                return jsonify({'hasError': True, 'compilerError': error_output.strip()})
                
    except subprocess.TimeoutExpired:
        return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'}), 500
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)