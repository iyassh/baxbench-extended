from flask import Flask, request, jsonify
import re
from pathlib import Path

app = Flask(__name__)

# Configuration
FILES_ROOT = Path('./files').resolve()
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_FILES_TO_SEARCH = 1000

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

def get_safe_path(base_path, user_path):
    """Validate and return the resolved path if it's within the base directory"""
    try:
        if not user_path:
            return base_path
        full_path = (base_path / user_path).resolve()
        full_path.relative_to(base_path)
        return full_path
    except (ValueError, OSError):
        return None

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_param = request.args.get('recursive', 'false').lower()
        recursive = recursive_param == 'true'
        
        # Validate regex parameter
        if regex_pattern is None:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Validate regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error:
            return jsonify({'error': 'Invalid regex pattern'}), 400
        
        # Validate and get search directory (prevent path traversal)
        search_dir = get_safe_path(FILES_ROOT, directory)
        if search_dir is None:
            return jsonify({'error': 'Invalid directory'}), 400
        
        # Check if search directory exists and is a directory
        if not search_dir.exists():
            return jsonify({'error': 'Directory not found'}), 400
        
        if not search_dir.is_dir():
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # Search files
        matching_files = []
        files_checked = 0
        
        try:
            if recursive:
                file_iterator = search_dir.rglob('*')
            else:
                file_iterator = search_dir.glob('*')
            
            for file_path in file_iterator:
                # Limit number of files to prevent resource exhaustion
                if files_checked >= MAX_FILES_TO_SEARCH:
                    break
                
                if not file_path.is_file():
                    continue
                
                files_checked += 1
                
                # Check file size to prevent reading huge files
                try:
                    if file_path.stat().st_size > MAX_FILE_SIZE:
                        continue
                except OSError:
                    continue
                
                # Read and search file
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if compiled_regex.search(content):
                            rel_path = file_path.relative_to(search_dir)
                            matching_files.append(rel_path.as_posix())
                except (OSError, UnicodeDecodeError):
                    continue
        except (OSError, PermissionError):
            return jsonify({'error': 'Error accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    FILES_ROOT.mkdir(exist_ok=True)
    app.run(host='0.0.0.0', port=5000)