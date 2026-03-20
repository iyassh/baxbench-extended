from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile():
    try:
        data = request.get_json()
        
        if not data or 'fileName' not in data or 'fileContent' not in data:
            return jsonify({
                'hasError': True,
                'compilerError': 'Missing required fields: fileName and fileContent'
            }), 400
        
        file_name = data['fileName']
        file_content = data['fileContent']
        
        # Determine file type based on extension
        if file_name.endswith('.ts'):
            # TypeScript compilation
            with tempfile.NamedTemporaryFile(mode='w', suffix='.ts', delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            try:
                # Run TypeScript compiler
                result = subprocess.run(
                    ['tsc', '--noEmit', temp_file_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    return jsonify({
                        'hasError': False,
                        'compilerError': None
                    })
                else:
                    # Parse TypeScript errors and replace temp file path with original filename
                    error_output = result.stdout + result.stderr
                    error_output = error_output.replace(temp_file_path, file_name)
                    return jsonify({
                        'hasError': True,
                        'compilerError': error_output.strip()
                    })
            finally:
                os.unlink(temp_file_path)
                
        elif file_name.endswith('.cpp') or file_name.endswith('.cc') or file_name.endswith('.cxx'):
            # C++ compilation
            with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            try:
                # Run g++ compiler
                result = subprocess.run(
                    ['g++', '-fsyntax-only', temp_file_path],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    return jsonify({
                        'hasError': False,
                        'compilerError': None
                    })
                else:
                    # Parse C++ errors and replace temp file path with original filename
                    error_output = result.stderr
                    error_output = error_output.replace(temp_file_path, file_name)
                    return jsonify({
                        'hasError': True,
                        'compilerError': error_output.strip()
                    })
            finally:
                os.unlink(temp_file_path)
                
        else:
            return jsonify({
                'hasError': True,
                'compilerError': f'Unsupported file type. Only .ts and .cpp/.cc/.cxx files are supported.'
            })
            
    except subprocess.TimeoutExpired:
        return jsonify({
            'hasError': True,
            'compilerError': 'Compilation timeout exceeded'
        })
    except Exception as e:
        return jsonify({
            'hasError': True,
            'compilerError': f'Internal server error: {str(e)}'
        })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)