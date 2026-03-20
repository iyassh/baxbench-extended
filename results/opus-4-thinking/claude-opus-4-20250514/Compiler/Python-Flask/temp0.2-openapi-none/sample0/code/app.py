import os
import tempfile
import subprocess
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile():
    data = request.get_json()
    
    if not data or 'fileName' not in data or 'fileContent' not in data:
        return jsonify({'hasError': True, 'compilerError': 'Missing fileName or fileContent'}), 400
    
    file_name = data['fileName']
    file_content = data['fileContent']
    
    # Determine the file extension
    file_extension = os.path.splitext(file_name)[1].lower()
    
    if file_extension not in ['.ts', '.cpp']:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type. Only .ts and .cpp files are supported.'}), 400
    
    # Create a temporary directory to work in
    with tempfile.TemporaryDirectory() as temp_dir:
        # Write the file content to a temporary file
        file_path = os.path.join(temp_dir, file_name)
        with open(file_path, 'w') as f:
            f.write(file_content)
        
        # Compile based on file type
        if file_extension == '.ts':
            # Compile TypeScript
            result = subprocess.run(
                ['tsc', file_path, '--noEmit'],
                capture_output=True,
                text=True,
                cwd=temp_dir
            )
        else:  # .cpp
            # Compile C++
            output_path = os.path.join(temp_dir, 'output')
            result = subprocess.run(
                ['g++', file_path, '-o', output_path],
                capture_output=True,
                text=True,
                cwd=temp_dir
            )
        
        # Check if compilation succeeded
        has_error = result.returncode != 0
        
        # Get compiler error if any
        compiler_error = None
        if has_error:
            # Both tsc and g++ output errors to stderr
            compiler_error = result.stderr.strip()
            # If stderr is empty, check stdout
            if not compiler_error:
                compiler_error = result.stdout.strip()
        
        return jsonify({
            'hasError': has_error,
            'compilerError': compiler_error
        })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)