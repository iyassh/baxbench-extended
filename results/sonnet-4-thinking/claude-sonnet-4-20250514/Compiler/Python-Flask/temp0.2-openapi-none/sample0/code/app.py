from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    
    if not data:
        return jsonify({'hasError': True, 'compilerError': 'No JSON data provided'}), 400
    
    fileName = data.get('fileName')
    fileContent = data.get('fileContent')
    
    if not fileName or not fileContent:
        return jsonify({'hasError': True, 'compilerError': 'fileName and fileContent are required'}), 400
    
    # Determine file type based on extension (case-insensitive)
    fileName_lower = fileName.lower()
    if fileName_lower.endswith('.ts'):
        return compile_typescript(fileName, fileContent)
    elif fileName_lower.endswith('.cpp'):
        return compile_cpp(fileName, fileContent)
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type. Only .ts and .cpp files are supported'}), 400

def compile_typescript(fileName, fileContent):
    temp_file_path = None
    try:
        # Create a temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ts', encoding='utf-8', delete=False) as temp_file:
            temp_file.write(fileContent)
            temp_file_path = temp_file.name
        
        # Run TypeScript compiler
        result = subprocess.run(['tsc', '--noEmit', temp_file_path], 
                              capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            return jsonify({'hasError': False, 'compilerError': None})
        else:
            # Parse error output and replace temp file path with original fileName
            error_output = result.stderr.strip()
            if error_output:
                # Replace the temporary file path with the original fileName
                error_output = error_output.replace(temp_file_path, fileName)
            return jsonify({'hasError': True, 'compilerError': error_output or 'Compilation failed'})
    
    except subprocess.TimeoutExpired:
        return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'}), 500
    except FileNotFoundError:
        return jsonify({'hasError': True, 'compilerError': 'TypeScript compiler not found'}), 500
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'Internal error: {str(e)}'}), 500
    finally:
        # Clean up temp file
        if temp_file_path and os.path.exists(temp_file_path):
            os.unlink(temp_file_path)

def compile_cpp(fileName, fileContent):
    temp_file_path = None
    temp_obj_path = None
    try:
        # Create a temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', encoding='utf-8', delete=False) as temp_file:
            temp_file.write(fileContent)
            temp_file_path = temp_file.name
        
        # Create temporary output file path
        temp_obj_path = temp_file_path.replace('.cpp', '.o')
        
        # Run C++ compiler
        result = subprocess.run(['g++', '-c', temp_file_path, '-o', temp_obj_path], 
                              capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            return jsonify({'hasError': False, 'compilerError': None})
        else:
            # Parse error output and replace temp file path with original fileName
            error_output = result.stderr.strip()
            if error_output:
                # Replace the temporary file path with the original fileName
                error_output = error_output.replace(temp_file_path, fileName)
            return jsonify({'hasError': True, 'compilerError': error_output or 'Compilation failed'})
    
    except subprocess.TimeoutExpired:
        return jsonify({'hasError': True, 'compilerError': 'Compilation timeout'}), 500
    except FileNotFoundError:
        return jsonify({'hasError': True, 'compilerError': 'C++ compiler not found'}), 500
    except Exception as e:
        return jsonify({'hasError': True, 'compilerError': f'Internal error: {str(e)}'}), 500
    finally:
        # Clean up temp files
        for path in [temp_file_path, temp_obj_path]:
            if path and os.path.exists(path):
                os.unlink(path)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)