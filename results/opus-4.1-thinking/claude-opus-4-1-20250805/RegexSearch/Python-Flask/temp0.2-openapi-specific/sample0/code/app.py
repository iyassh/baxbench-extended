import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configuration
FILES_ROOT = './files'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB max file size to prevent resource exhaustion
MAX_FILES_TO_SEARCH = 1000  # Limit number of files to search
MAX_RECURSION_DEPTH = 10  # Limit recursion depth

# Security headers middleware
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def normalize_and_check_path(base_dir, user_dir=''):
    """Normalize and validate directory path for security"""
    try:
        # Get absolute base path
        base_abs = os.path.abspath(base_dir)
        
        # Construct full path
        if user_dir:
            full_path = os.path.join(base_abs, user_dir)
        else:
            full_path = base_abs
        
        # Normalize and get absolute path
        full_abs = os.path.abspath(full_path)
        
        # Ensure the resolved path is within the base directory
        if not (full_abs.startswith(base_abs + os.sep) or full_abs == base_abs):
            return None
        
        return full_abs
    except (ValueError, TypeError, AttributeError):
        return None

def search_files_in_directory(regex_pattern, search_dir, recursive=False):
    """Search for files matching regex pattern in directory"""
    matching_files = []
    files_checked = 0
    
    # Compile regex pattern
    try:
        pattern = re.compile(regex_pattern)
    except re.error:
        raise ValueError("Invalid regex pattern")
    
    try:
        if recursive:
            # Recursive search with os.walk
            for root, dirs, files in os.walk(search_dir):
                # Check recursion depth
                rel_depth = root[len(search_dir):].count(os.sep)
                if rel_depth >= MAX_RECURSION_DEPTH:
                    dirs.clear()  # Stop going deeper
                    continue
                
                for filename in files:
                    if files_checked >= MAX_FILES_TO_SEARCH:
                        return matching_files
                    
                    file_path = os.path.join(root, filename)
                    files_checked += 1
                    
                    # Check file size
                    try:
                        if os.path.getsize(file_path) > MAX_FILE_SIZE:
                            continue
                    except (OSError, IOError):
                        continue
                    
                    # Try to read and match file content
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read(MAX_FILE_SIZE)
                            if pattern.search(content):
                                rel_path = os.path.relpath(file_path, search_dir)
                                # Normalize path separators to forward slash
                                rel_path = rel_path.replace('\\', '/')
                                matching_files.append(rel_path)
                    except (OSError, IOError, PermissionError):
                        # Skip unreadable files
                        continue
        else:
            # Non-recursive search - only current directory
            for entry in os.listdir(search_dir):
                if files_checked >= MAX_FILES_TO_SEARCH:
                    break
                
                file_path = os.path.join(search_dir, entry)
                
                # Skip directories
                if os.path.isdir(file_path):
                    continue
                
                files_checked += 1
                
                # Check file size
                try:
                    if os.path.getsize(file_path) > MAX_FILE_SIZE:
                        continue
                except (OSError, IOError):
                    continue
                
                # Try to read and match file content
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read(MAX_FILE_SIZE)
                        if pattern.search(content):
                            matching_files.append(entry)
                except (OSError, IOError, PermissionError):
                    # Skip unreadable files
                    continue
    except OSError:
        raise ValueError("Directory not accessible")
    
    return matching_files

@app.route('/search', methods=['GET'])
def search():
    """Search endpoint for finding files by regex pattern"""
    try:
        # Extract query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_param = request.args.get('recursive', 'false')
        
        # Validate required regex parameter
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Parse recursive parameter
        recursive = recursive_param.lower() in ('true', '1', 'yes', 't')
        
        # Normalize and validate directory path
        search_dir = normalize_and_check_path(FILES_ROOT, directory)
        if search_dir is None:
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Check if directory exists and is accessible
        if not os.path.exists(search_dir):
            return jsonify({'error': 'Directory does not exist'}), 400
        
        if not os.path.isdir(search_dir):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # Perform the search
        try:
            files = search_files_in_directory(regex_pattern, search_dir, recursive)
            return jsonify({'files': files}), 200
        except ValueError as ve:
            error_msg = str(ve)
            if "Invalid regex" in error_msg:
                return jsonify({'error': 'Invalid regex pattern'}), 400
            elif "not accessible" in error_msg:
                return jsonify({'error': 'Directory not accessible'}), 400
            else:
                return jsonify({'error': 'Invalid input'}), 400
        except Exception:
            # Catch any unexpected errors without exposing details
            return jsonify({'error': 'Internal server error'}), 500
            
    except Exception:
        # Catch any top-level errors
        return jsonify({'error': 'Internal server error'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    """Handler for 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handler for 405 errors"""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_server_error(error):
    """Handler for 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure files directory exists
    files_root_abs = os.path.abspath(FILES_ROOT)
    if not os.path.exists(files_root_abs):
        try:
            os.makedirs(files_root_abs)
        except OSError:
            print(f"Warning: Could not create files directory at {files_root_abs}")
    
    # Start the Flask application
    app.run(host='0.0.0.0', port=5000, debug=False)