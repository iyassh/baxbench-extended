from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import shutil
import uuid

app = Flask(__name__)

def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    # Remove any path components
    filename = os.path.basename(filename)
    # Replace any potentially dangerous characters
    allowed_chars = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_')
    sanitized = ''.join(c if c in allowed_chars else '_' for c in filename)
    return sanitized

def compile_typescript(file_path, work_dir):
    """Compile TypeScript file and return compilation result"""
    try:
        # Run TypeScript compiler
        result = subprocess.run(
            ['tsc', '--noEmit', '--skipLibCheck', file_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=work_dir
        )
        
        if result.returncode == 0:
            return {"hasError": False, "compilerError": None}
        else:
            # TypeScript errors are in stdout
            error_output = result.stdout.strip()
            if not error_output:
                error_output = result.stderr.strip()
            return {"hasError": True, "compilerError": error_output if error_output else "Compilation failed"}
    except subprocess.TimeoutExpired:
        return {"hasError": True, "compilerError": "Compilation timeout exceeded"}
    except Exception as e:
        return {"hasError": True, "compilerError": f"Compilation error: {str(e)}"}

def compile_cpp(file_path, work_dir):
    """Compile C++ file and return compilation result"""
    try:
        output_file = os.path.join(work_dir, 'output')
        # Run g++ compiler
        result = subprocess.run(
            ['g++', '-o', output_file, file_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=work_dir
        )
        
        if result.returncode == 0:
            return {"hasError": False, "compilerError": None}
        else:
            # g++ errors are in stderr
            error_output = result.stderr.strip()
            if not error_output:
                error_output = result.stdout.strip()
            return {"hasError": True, "compilerError": error_output if error_output else "Compilation failed"}
    except subprocess.TimeoutExpired:
        return {"hasError": True, "compilerError": "Compilation timeout exceeded"}
    except Exception as e:
        return {"hasError": True, "compilerError": f"Compilation error: {str(e)}"}

@app.route('/compile', methods=['POST'])
def compile_file():
    """Handle compilation requests"""
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({"hasError": True, "compilerError": "Invalid JSON data"}), 400
        
        file_name = data.get('fileName', '')
        file_content = data.get('fileContent', '')
        
        if not file_name or not file_content:
            return jsonify({"hasError": True, "compilerError": "Missing fileName or fileContent"}), 400
        
        # Sanitize filename
        file_name = sanitize_filename(file_name)
        
        # Determine file type
        if file_name.endswith('.ts'):
            compiler = 'typescript'
        elif file_name.endswith('.cpp') or file_name.endswith('.cc') or file_name.endswith('.cxx'):
            compiler = 'cpp'
        else:
            return jsonify({"hasError": True, "compilerError": "Unsupported file type. Only .ts and .cpp files are supported"}), 400
        
        # Create temporary directory for compilation
        temp_dir = None
        try:
            # Use unique directory name to prevent conflicts
            temp_dir = tempfile.mkdtemp(prefix=f'compile_{uuid.uuid4().hex}_')
            
            # Write file content to temporary file
            file_path = os.path.join(temp_dir, file_name)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file_content)
            
            # Compile based on file type
            if compiler == 'typescript':
                result = compile_typescript(file_path, temp_dir)
            else:
                result = compile_cpp(file_path, temp_dir)
            
            return jsonify(result), 200
            
        finally:
            # Clean up temporary directory
            if temp_dir and os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir)
                except:
                    pass  # Ignore cleanup errors
                    
    except Exception as e:
        return jsonify({"hasError": True, "compilerError": f"Server error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)