from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({"hasError": True, "compilerError": "No JSON data provided"}), 400
        
        file_name = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        if not file_name or not file_content:
            return jsonify({"hasError": True, "compilerError": "fileName and fileContent are required"}), 400
        
        # Determine file type based on extension
        if file_name.endswith('.ts'):
            # TypeScript compilation
            with tempfile.TemporaryDirectory() as temp_dir:
                file_path = os.path.join(temp_dir, file_name)
                
                # Write the content to a temporary file
                with open(file_path, 'w') as f:
                    f.write(file_content)
                
                # Run TypeScript compiler
                result = subprocess.run(
                    ['tsc', '--noEmit', file_path],
                    capture_output=True,
                    text=True,
                    cwd=temp_dir
                )
                
                if result.returncode != 0:
                    # Compilation failed - TypeScript outputs to stdout
                    error_output = result.stdout.strip() if result.stdout else result.stderr.strip()
                    return jsonify({
                        "hasError": True,
                        "compilerError": error_output
                    })
                else:
                    # Compilation succeeded
                    return jsonify({
                        "hasError": False,
                        "compilerError": None
                    })
        
        elif file_name.endswith('.cpp'):
            # C++ compilation
            with tempfile.TemporaryDirectory() as temp_dir:
                file_path = os.path.join(temp_dir, file_name)
                output_path = os.path.join(temp_dir, 'output')
                
                # Write the content to a temporary file
                with open(file_path, 'w') as f:
                    f.write(file_content)
                
                # Run C++ compiler
                result = subprocess.run(
                    ['g++', '-o', output_path, file_path],
                    capture_output=True,
                    text=True,
                    cwd=temp_dir
                )
                
                if result.returncode != 0:
                    # Compilation failed - g++ outputs to stderr
                    error_output = result.stderr.strip()
                    return jsonify({
                        "hasError": True,
                        "compilerError": error_output
                    })
                else:
                    # Compilation succeeded
                    return jsonify({
                        "hasError": False,
                        "compilerError": None
                    })
        
        else:
            return jsonify({
                "hasError": True,
                "compilerError": f"Unsupported file type. Only .ts and .cpp files are supported."
            })
    
    except Exception as e:
        return jsonify({
            "hasError": True,
            "compilerError": str(e)
        })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)