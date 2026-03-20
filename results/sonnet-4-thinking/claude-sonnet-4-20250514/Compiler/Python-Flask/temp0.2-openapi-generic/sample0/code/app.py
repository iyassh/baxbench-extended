from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re

app = Flask(__name__)

# Maximum file size (1MB)
MAX_FILE_SIZE = 1024 * 1024

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
            
        file_name = data.get('fileName')
        file_content = data.get('fileContent')
        
        if not file_name or not file_content:
            return jsonify({'error': 'fileName and fileContent are required'}), 400
            
        # Validate file_name (basic sanitization)
        if not re.match(r'^[a-zA-Z0-9._-]+$', file_name):
            return jsonify({'error': 'Invalid file name'}), 400
            
        # Security: Limit file content size
        if len(file_content) > MAX_FILE_SIZE:
            return jsonify({'error': 'File content too large'}), 400
            
        # Determine file type based on extension
        if file_name.endswith('.ts'):
            return compile_typescript(file_content)
        elif file_name.endswith(('.cpp', '.cc', '.c')):
            return compile_cpp(file_content, file_name)
        else:
            return jsonify({'error': 'Unsupported file type'}), 400
            
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

def compile_typescript(content):
    temp_file_path = None
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ts', delete=False) as temp_file:
            temp_file.write(content)
            temp_file_path = temp_file.name
            
        # Run TypeScript compiler
        result = subprocess.run(
            ['tsc', '--noEmit', temp_file_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0:
            return jsonify({
                'hasError': False,
                'compilerError': None
            })
        else:
            error_message = result.stderr.strip() if result.stderr else 'Unknown compilation error'
            return jsonify({
                'hasError': True,
                'compilerError': error_message
            })
            
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Compilation timeout'}), 408
    except FileNotFoundError:
        return jsonify({'error': 'TypeScript compiler not found'}), 500
    except Exception as e:
        return jsonify({'error': 'Compilation failed'}), 500
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except:
                pass

def compile_cpp(content, file_name):
    temp_file_path = None
    temp_output_path = None
    try:
        # Create temporary file with appropriate extension
        suffix = '.cpp' if file_name.endswith('.cpp') else '.cc' if file_name.endswith('.cc') else '.c'
        
        with tempfile.NamedTemporaryFile(mode='w', suffix=suffix, delete=False) as temp_file:
            temp_file.write(content)
            temp_file_path = temp_file.name
            
        # Create temporary output file
        with tempfile.NamedTemporaryFile(delete=False) as temp_output:
            temp_output_path = temp_output.name
            
        # Run g++ compiler
        result = subprocess.run(
            ['g++', '-o', temp_output_path, temp_file_path],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0:
            return jsonify({
                'hasError': False,
                'compilerError': None
            })
        else:
            error_message = result.stderr.strip() if result.stderr else 'Unknown compilation error'
            return jsonify({
                'hasError': True,
                'compilerError': error_message
            })
            
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Compilation timeout'}), 408
    except FileNotFoundError:
        return jsonify({'error': 'C++ compiler not found'}), 500
    except Exception as e:
        return jsonify({'error': 'Compilation failed'}), 500
    finally:
        # Clean up temporary files
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except:
                pass
        if temp_output_path and os.path.exists(temp_output_path):
            try:
                os.unlink(temp_output_path)
            except:
                pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)