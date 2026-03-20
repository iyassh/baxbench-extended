from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

# Maximum file size in characters (to prevent abuse)
MAX_FILE_SIZE = 1000000  # 1MB of text

@app.route('/compile', methods=['POST'])
def compile_code():
    temp_file_path = None
    file_ext = None
    
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'hasError': True, 'compilerError': 'No JSON data provided'}), 400
        
        file_name = data.get('fileName')
        file_content = data.get('fileContent')
        
        # Validate inputs
        if not file_name or file_content is None:
            return jsonify({'hasError': True, 'compilerError': 'Missing fileName or fileContent'}), 400
        
        if not isinstance(file_name, str) or not isinstance(file_content, str):
            return jsonify({'hasError': True, 'compilerError': 'fileName and fileContent must be strings'}), 400
        
        # Security: check file size
        if len(file_content) > MAX_FILE_SIZE:
            return jsonify({'hasError': True, 'compilerError': 'File content too large'}), 400
        
        # Security: ensure fileName is just a filename, not a path
        if '/' in file_name or '\\' in file_name or '..' in file_name:
            return jsonify({'hasError': True, 'compilerError': 'Invalid fileName'}), 400
        
        # Determine file type and compiler
        if file_name.endswith('.ts'):
            compiler_cmd = ['tsc', '--noEmit']
            file_ext = '.ts'
        elif file_name.endswith('.cpp'):
            compiler_cmd = ['g++', '-c']
            file_ext = '.cpp'
        else:
            return jsonify({'hasError': True, 'compilerError': 'Unsupported file type. Only .ts and .cpp are supported'}), 400
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix=file_ext, delete=False, encoding='utf-8') as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name
        
        # Run compiler
        if file_ext == '.ts':
            result = subprocess.run(
                compiler_cmd + [temp_file_path],
                capture_output=True,
                text=True,
                timeout=10
            )
        else:  # .cpp
            result = subprocess.run(
                compiler_cmd + [temp_file_path, '-o', temp_file_path + '.o'],
                capture_output=True,
                text=True,
                timeout=10
            )
        
        # Check if compilation succeeded
        if result.returncode == 0:
            return jsonify({'hasError': False, 'compilerError': None})
        else:
            # Compilation failed, get error message
            error_output = (result.stderr or result.stdout or "").strip()
            return jsonify({'hasError': True, 'compilerError': error_output})
    
    except subprocess.TimeoutExpired:
        return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'}), 500
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'Internal server error: {str(e)}'}), 500
    finally:
        # Clean up temporary files
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except:
                pass
        if temp_file_path and file_ext == '.cpp' and os.path.exists(temp_file_path + '.o'):
            try:
                os.remove(temp_file_path + '.o')
            except:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)