import os
import tempfile
import subprocess
import json
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Allowed file extensions and their corresponding compilers
ALLOWED_EXTENSIONS = {
    '.ts': ['tsc', '--noEmit'],
    '.cpp': ['g++', '-fsyntax-only', '-Wall', '-Wextra']
}

def validate_filename(filename):
    """Validate that the filename has an allowed extension"""
    if not filename:
        return False
    
    # Check for path traversal attempts
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Check extension
    for ext in ALLOWED_EXTENSIONS:
        if filename.endswith(ext):
            return True
    return False

def sanitize_content(content):
    """Basic sanitization of file content"""
    if not content:
        return ""
    
    # Limit content size to prevent DoS
    max_size = 1024 * 1024  # 1MB
    if len(content) > max_size:
        raise BadRequest("File content too large")
    
    return content

def compile_file(filename, content):
    """Compile the given file and return compilation results"""
    # Determine compiler based on extension
    compiler_cmd = None
    for ext, cmd in ALLOWED_EXTENSIONS.items():
        if filename.endswith(ext):
            compiler_cmd = cmd.copy()
            break
    
    if not compiler_cmd:
        return {
            "hasError": True,
            "compilerError": "Unsupported file type"
        }
    
    # Create temporary file
    with tempfile.NamedTemporaryFile(mode='w', suffix=os.path.splitext(filename)[1], 
                                   delete=False) as tmp_file:
        tmp_file.write(content)
        tmp_file_path = tmp_file.name
    
    try:
        # Add filename to compiler command
        if filename.endswith('.cpp'):
            compiler_cmd.append(tmp_file_path)
        else:  # TypeScript
            compiler_cmd.append(tmp_file_path)
        
        # Run compiler
        result = subprocess.run(
            compiler_cmd,
            capture_output=True,
            text=True,
            timeout=10  # 10 second timeout
        )
        
        # Check compilation result
        if result.returncode == 0:
            return {
                "hasError": False,
                "compilerError": None
            }
        else:
            # Format error message
            error_output = result.stderr or result.stdout
            
            # For TypeScript, replace temp file path with original filename
            if filename.endswith('.ts'):
                error_output = error_output.replace(tmp_file_path, filename)
            
            return {
                "hasError": True,
                "compilerError": error_output.strip()
            }
            
    except subprocess.TimeoutExpired:
        return {
            "hasError": True,
            "compilerError": "Compilation timeout exceeded"
        }
    except Exception as e:
        return {
            "hasError": True,
            "compilerError": f"Compilation error: {str(e)}"
        }
    finally:
        # Clean up temporary file
        try:
            os.unlink(tmp_file_path)
        except:
            pass

@app.route('/compile', methods=['POST'])
def compile():
    """Handle compilation requests"""
    # Validate content type
    if not request.is_json:
        return jsonify({
            "hasError": True,
            "compilerError": "Content-Type must be application/json"
        }), 400
    
    # Get request data
    try:
        data = request.get_json()
    except:
        return jsonify({
            "hasError": True,
            "compilerError": "Invalid JSON"
        }), 400
    
    # Validate required fields
    if not data or 'fileName' not in data or 'fileContent' not in data:
        return jsonify({
            "hasError": True,
            "compilerError": "Missing required fields: fileName and fileContent"
        }), 400
    
    filename = data.get('fileName', '')
    content = data.get('fileContent', '')
    
    # Validate filename
    if not validate_filename(filename):
        return jsonify({
            "hasError": True,
            "compilerError": "Invalid filename. Only .ts and .cpp files are supported."
        }), 400
    
    # Sanitize content
    try:
        content = sanitize_content(content)
    except BadRequest as e:
        return jsonify({
            "hasError": True,
            "compilerError": str(e)
        }), 400
    
    # Compile the file
    result = compile_file(filename, content)
    
    return jsonify(result), 200

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "error": "Endpoint not found"
    }), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({
        "error": "Method not allowed"
    }), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        "error": "Internal server error"
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)