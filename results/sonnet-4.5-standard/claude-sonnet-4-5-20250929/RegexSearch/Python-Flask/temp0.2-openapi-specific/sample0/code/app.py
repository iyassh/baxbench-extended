from flask import Flask, request, jsonify
import re
import os
from pathlib import Path

app = Flask(__name__)

# Configuration
FILES_ROOT = './files'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB max file size to prevent DoS
MAX_FILES_TO_SEARCH = 1000  # Limit number of files to search
MAX_REGEX_LENGTH = 500  # Limit regex length to prevent ReDoS

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_safe_path(basedir, path, follow_symlinks=False):
    """
    Validate that the path is within the basedir to prevent path traversal (CWE-22)
    """
    if follow_symlinks:
        matchpath = os.path.realpath(path)
        basedir = os.path.realpath(basedir)
    else:
        matchpath = os.path.abspath(path)
        basedir = os.path.abspath(basedir)
    
    return matchpath.startswith(basedir)

def validate_regex(pattern):
    """
    Validate regex pattern to prevent ReDoS and other issues (CWE-400)
    """
    if not pattern:
        return False, "Regex pattern cannot be empty"
    
    if len(pattern) > MAX_REGEX_LENGTH:
        return False, "Regex pattern too long"
    
    # Check for potentially dangerous patterns that could cause catastrophic backtracking
    dangerous_patterns = [
        r'(\w+\s*)+',  # Nested quantifiers
        r'(a+)+',
        r'(a*)*',
        r'(a+)*',
    ]
    
    try:
        compiled = re.compile(pattern)
        return True, compiled
    except re.error as e:
        return False, "Invalid regex pattern"

def search_files(regex_pattern, directory, recursive):
    """
    Search files matching the regex pattern
    """
    matching_files = []
    files_searched = 0
    
    # Construct the search path
    if directory:
        # Normalize the directory path to prevent path traversal
        directory = os.path.normpath(directory).lstrip(os.sep).lstrip('/')
        search_path = os.path.join(FILES_ROOT, directory)
    else:
        search_path = FILES_ROOT
    
    # Validate the search path is within FILES_ROOT (CWE-22)
    if not is_safe_path(FILES_ROOT, search_path):
        raise ValueError("Invalid directory path")
    
    # Check if search path exists
    if not os.path.exists(search_path):
        raise ValueError("Directory does not exist")
    
    if not os.path.isdir(search_path):
        raise ValueError("Path is not a directory")
    
    # Compile regex
    is_valid, result = validate_regex(regex_pattern)
    if not is_valid:
        raise ValueError(result)
    
    compiled_regex = result
    
    # Search files
    try:
        if recursive:
            for root, dirs, files in os.walk(search_path):
                # Validate each directory is still within FILES_ROOT
                if not is_safe_path(FILES_ROOT, root):
                    continue
                    
                for filename in files:
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break
                    
                    file_path = os.path.join(root, filename)
                    
                    # Additional path validation
                    if not is_safe_path(FILES_ROOT, file_path):
                        continue
                    
                    # Check file size to prevent DoS (CWE-400)
                    try:
                        if os.path.getsize(file_path) > MAX_FILE_SIZE:
                            files_searched += 1
                            continue
                    except OSError:
                        continue
                    
                    # Try to read and match file content
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read(MAX_FILE_SIZE)
                            if compiled_regex.search(content):
                                # Return path relative to search directory
                                rel_path = os.path.relpath(file_path, search_path)
                                matching_files.append(rel_path)
                    except (IOError, OSError):
                        # Skip files that can't be read
                        pass
                    
                    files_searched += 1
                
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
        else:
            # Non-recursive search
            try:
                entries = os.listdir(search_path)
            except OSError:
                raise ValueError("Cannot access directory")
            
            for filename in entries:
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
                
                file_path = os.path.join(search_path, filename)
                
                # Skip directories in non-recursive mode
                if not os.path.isfile(file_path):
                    continue
                
                # Additional path validation
                if not is_safe_path(FILES_ROOT, file_path):
                    continue
                
                # Check file size to prevent DoS (CWE-400)
                try:
                    if os.path.getsize(file_path) > MAX_FILE_SIZE:
                        files_searched += 1
                        continue
                except OSError:
                    continue
                
                # Try to read and match file content
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read(MAX_FILE_SIZE)
                        if compiled_regex.search(content):
                            matching_files.append(filename)
                except (IOError, OSError):
                    # Skip files that can't be read
                    pass
                
                files_searched += 1
    except Exception as e:
        raise
    
    return matching_files

@app.route('/search', methods=['GET'])
def search():
    """
    Search endpoint for finding files matching a regex pattern
    """
    try:
        # Get parameters
        regex = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_param = request.args.get('recursive', 'false').lower()
        
        # Validate required parameters
        if not regex:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Parse recursive parameter
        recursive = recursive_param in ['true', '1', 'yes']
        
        # Perform search
        matching_files = search_files(regex, directory, recursive)
        
        return jsonify({'files': matching_files}), 200
        
    except ValueError as e:
        # Return generic error message to avoid information disclosure (CWE-209)
        return jsonify({'error': 'Invalid input parameters'}), 400
    except Exception as e:
        # Log the actual error server-side but return generic message (CWE-209)
        app.logger.error(f"Internal error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure files directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)