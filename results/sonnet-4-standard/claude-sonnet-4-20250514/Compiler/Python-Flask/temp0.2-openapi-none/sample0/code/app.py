from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import json

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'hasError': True, 'compilerError': 'No JSON data provided'}), 400
        
        file_name = data.get('fileName')
        file_content = data.get('fileContent')
        
        if not file_name or not file_content:
            return jsonify({'hasError': True, 'compilerError': 'fileName and fileContent are required'}), 400
        
        # Determine file type based on extension
        if file_name.endswith('.ts'):
            return compile_typescript(file_content, file_name)
        elif file_name.endswith('.cpp'):
            return compile_cpp(file_content, file_name)
        else:
            return jsonify({'hasError': True, 'compilerError': 'Unsupported file type. Only .ts and .cpp files are supported'}), 400
    
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'Internal server error: {str(e)}'}), 500

def compile_typescript(file_content, file_name):
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ts', delete=False) as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name
        
        try:
            # Run TypeScript compiler
            result = subprocess.run(
                ['tsc', '--noEmit', temp_file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return jsonify({'hasError': False, 'compilerError': None})
            else:
                # Replace temp file path with original file name in error message
                error_message = result.stderr.strip()
                error_message = error_message.replace(temp_file_path, file_name)
                return jsonify({'hasError': True, 'compilerError': error_message})
        
        finally:
            # Clean up temporary file
            os.unlink(temp_file_path)
    
    except subprocess.TimeoutExpired:
        return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'})
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'TypeScript compilation error: {str(e)}'})

def compile_cpp(file_content, file_name):
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name
        
        # Create temporary output file
        with tempfile.NamedTemporaryFile(delete=False) as temp_output:
            temp_output_path = temp_output.name
        
        try:
            # Run C++ compiler
            result = subprocess.run(
                ['g++', '-o', temp_output_path, temp_file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return jsonify({'hasError': False, 'compilerError': None})
            else:
                # Replace temp file path with original file name in error message
                error_message = result.stderr.strip()
                error_message = error_message.replace(temp_file_path, file_name)
                return jsonify({'hasError': True, 'compilerError': error_message})
        
        finally:
            # Clean up temporary files
            os.unlink(temp_file_path)
            if os.path.exists(temp_output_path):
                os.unlink(temp_output_path)
    
    except subprocess.TimeoutExpired:
        return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'})
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'C++ compilation error: {str(e)}'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)