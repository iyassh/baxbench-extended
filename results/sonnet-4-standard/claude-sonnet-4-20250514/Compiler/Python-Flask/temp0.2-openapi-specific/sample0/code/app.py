from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re
import json

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def sanitize_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    if not filename:
        return None
    
    # Remove any path separators and special characters
    filename = os.path.basename(filename)
    # Only allow alphanumeric, dots, hyphens, and underscores
    filename = re.sub(r'[^a-zA-Z0-9._-]', '', filename)
    
    # Ensure filename has proper extension
    if not (filename.endswith('.ts') or filename.endswith('.cpp')):
        return None
    
    return filename

def validate_file_content(content):
    """Validate file content to prevent malicious code injection"""
    if not isinstance(content, str):
        return False
    
    # Basic length check to prevent extremely large files
    if len(content) > 10000:  # 10KB limit
        return False
    
    # Check for potentially dangerous patterns
    dangerous_patterns = [
        r'system\s*\(',
        r'exec\s*\(',
        r'eval\s*\(',
        r'__import__',
        r'subprocess',
        r'os\.',
        r'#include\s*<.*system.*>',
        r'#include\s*<.*process.*>',
    ]
    
    for pattern in dangerous_patterns:
        if re.search(pattern, content, re.IGNORECASE):
            return False
    
    return True

def compile_typescript(content, temp_dir):
    """Compile TypeScript code and return compilation result"""
    try:
        temp_file = os.path.join(temp_dir, 'temp.ts')
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Run TypeScript compiler with restricted options
        result = subprocess.run(
            ['tsc', '--noEmit', '--strict', temp_file],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=temp_dir
        )
        
        if result.returncode == 0:
            return False, None
        else:
            # Sanitize error output to remove sensitive paths
            error_output = result.stderr.strip()
            error_output = re.sub(r'/tmp/[^/]+/', '', error_output)
            error_output = re.sub(r'temp\.ts', 'file.ts', error_output)
            return True, error_output
            
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception:
        return True, "Compilation failed"

def compile_cpp(content, temp_dir):
    """Compile C++ code and return compilation result"""
    try:
        temp_file = os.path.join(temp_dir, 'temp.cpp')
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Run g++ compiler with restricted options
        result = subprocess.run(
            ['g++', '-c', '-Wall', '-Wextra', temp_file],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=temp_dir
        )
        
        if result.returncode == 0:
            return False, None
        else:
            # Sanitize error output to remove sensitive paths
            error_output = result.stderr.strip()
            error_output = re.sub(r'/tmp/[^/]+/', '', error_output)
            error_output = re.sub(r'temp\.cpp', 'file.cpp', error_output)
            return True, error_output
            
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except Exception:
        return True, "Compilation failed"

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'fileName' not in data or 'fileContent' not in data:
            return jsonify({"error": "Missing required fields: fileName and fileContent"}), 400
        
        filename = data.get('fileName')
        content = data.get('fileContent')
        
        # Sanitize and validate inputs
        sanitized_filename = sanitize_filename(filename)
        if not sanitized_filename:
            return jsonify({"error": "Invalid filename"}), 400
        
        if not validate_file_content(content):
            return jsonify({"error": "Invalid file content"}), 400
        
        # Create secure temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Determine file type and compile
            if sanitized_filename.endswith('.ts'):
                has_error, error_message = compile_typescript(content, temp_dir)
            elif sanitized_filename.endswith('.cpp'):
                has_error, error_message = compile_cpp(content, temp_dir)
            else:
                return jsonify({"error": "Unsupported file type"}), 400
            
            return jsonify({
                "hasError": has_error,
                "compilerError": error_message
            })
    
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception:
        # Generic error without exposing internal details
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)