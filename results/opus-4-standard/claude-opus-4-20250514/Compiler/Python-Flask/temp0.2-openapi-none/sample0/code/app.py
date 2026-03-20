from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        
        file_name = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        if not file_name or not file_content:
            return jsonify({"error": "fileName and fileContent are required"}), 400
        
        # Determine file extension and compiler
        file_extension = os.path.splitext(file_name)[1].lower()
        
        # Create a temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Write the file content to a temporary file
            file_path = os.path.join(temp_dir, file_name)
            with open(file_path, 'w') as f:
                f.write(file_content)
            
            if file_extension == '.ts':
                # TypeScript compilation
                result = subprocess.run(
                    ['tsc', '--noEmit', file_path],
                    capture_output=True,
                    text=True,
                    cwd=temp_dir
                )
            elif file_extension in ['.cpp', '.cc', '.cxx', '.c++']:
                # C++ compilation
                output_path = os.path.join(temp_dir, 'output')
                result = subprocess.run(
                    ['g++', '-o', output_path, file_path],
                    capture_output=True,
                    text=True,
                    cwd=temp_dir
                )
            else:
                return jsonify({
                    "hasError": True,
                    "compilerError": f"Unsupported file type: {file_extension}. Only .ts and .cpp files are supported."
                }), 200
            
            # Check if compilation was successful
            has_error = result.returncode != 0
            compiler_error = None
            
            if has_error:
                # Combine stderr and stdout for error messages
                compiler_error = result.stderr if result.stderr else result.stdout
                compiler_error = compiler_error.strip() if compiler_error else "Unknown compilation error"
            
            return jsonify({
                "hasError": has_error,
                "compilerError": compiler_error
            }), 200
            
    except Exception as e:
        return jsonify({
            "hasError": True,
            "compilerError": f"Internal server error: {str(e)}"
        }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)