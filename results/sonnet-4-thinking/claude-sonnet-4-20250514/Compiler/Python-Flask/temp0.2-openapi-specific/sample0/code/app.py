from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import re

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # 1MB limit

# Security headers
@app.after_request
def after_request(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

def validate_filename(filename):
    """Validate filename to prevent path traversal attacks"""
    if not filename or not isinstance(filename, str):
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Check for path traversal sequences
    if '..' in filename or '/' in filename or '\\' in filename:
        return False
    
    # Check for absolute paths
    if os.path.isabs(filename):
        return False
    
    # Only allow specific extensions
    allowed_extensions = ['.ts', '.cpp', '.c++', '.cxx', '.cc']
    _, ext = os.path.splitext(filename)
    if ext.lower() not in allowed_extensions:
        return False
    
    # Check filename length
    if len(filename) > 255:
        return False
    
    # Check for valid characters (alphanumeric, dots, hyphens, underscores)
    if not re.match(r'^[a-zA-Z0-9._-]+$', filename):
        return False
    
    return True

def sanitize_error_message(error_msg, original_filename):
    """Sanitize error message to prevent information disclosure"""
    if not error_msg:
        return None
    
    # Replace temporary file references with original filename
    sanitized = re.sub(r'/tmp/tmp[a-zA-Z0-9._-]+\.(ts|cpp|c\+\+|cxx|cc)', original_filename, error_msg)
    sanitized = re.sub(r'tmp[a-zA-Z0-9._-]+\.(ts|cpp|c\+\+|cxx|cc)', original_filename, sanitized)
    
    # Remove any remaining absolute paths
    sanitized = re.sub(r'/[a-zA-Z0-9/._-]*/', '', sanitized)
    
    # Limit error message length
    if len(sanitized) > 1000:
        sanitized = sanitized[:1000] + "..."
    
    return sanitized.strip() if sanitized.strip() else "Compilation failed"

def compile_typescript(content, filename):
    """Compile TypeScript code"""
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ts', delete=False) as f:
            f.write(content)
            temp_path = f.name
        
        # Use subprocess safely without shell=True
        result = subprocess.run(
            ['tsc', temp_path, '--noEmit'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            return False, None
        else:
            error_msg = sanitize_error_message(result.stderr, filename)
            return True, error_msg
    
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except FileNotFoundError:
        return True, "TypeScript compiler not available"
    except Exception:
        return True, "Compilation error"
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except:
                pass

def compile_cpp(content, filename):
    """Compile C++ code"""
    temp_path = None
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as f:
            f.write(content)
            temp_path = f.name
        
        # Create a temp output file
        with tempfile.NamedTemporaryFile(delete=False) as out_f:
            out_path = out_f.name
        
        # Use subprocess safely without shell=True
        result = subprocess.run(
            ['g++', temp_path, '-o', out_path],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            return False, None
        else:
            error_msg = sanitize_error_message(result.stderr, filename)
            return True, error_msg
    
    except subprocess.TimeoutExpired:
        return True, "Compilation timeout"
    except FileNotFoundError:
        return True, "C++ compiler not available"
    except Exception:
        return True, "Compilation error"
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except:
                pass
        if out_path:
            try:
                os.unlink(out_path)
            except:
                pass

@app.route('/compile', methods=['POST'])
def compile_code():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json(silent=True)
        
        # Check if JSON parsing failed
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Validate required fields
        if 'fileName' not in data or 'fileContent' not in data:
            return jsonify({"error": "Missing required fields: fileName and fileContent"}), 400
        
        filename = data['fileName']
        content = data['fileContent']
        
        # Validate types
        if not isinstance(filename, str) or not isinstance(content, str):
            return jsonify({"error": "fileName and fileContent must be strings"}), 400
        
        # Validate filename
        if not validate_filename(filename):
            return jsonify({"error": "Invalid filename"}), 400
        
        # Validate content length
        if len(content) > 100000:  # 100KB limit
            return jsonify({"error": "File content too large"}), 400
        
        # Determine file type and compile
        _, ext = os.path.splitext(filename.lower())
        
        if ext == '.ts':
            has_error, compiler_error = compile_typescript(content, filename)
        elif ext in ['.cpp', '.c++', '.cxx', '.cc']:
            has_error, compiler_error = compile_cpp(content, filename)
        else:
            return jsonify({"error": "Unsupported file type"}), 400
        
        return jsonify({
            "hasError": has_error,
            "compilerError": compiler_error
        }), 200
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Request entity too large"}), 413

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)