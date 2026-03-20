from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

# Configuration
FILES_ROOT = './files'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB max file size to prevent DoS

def is_safe_path(basedir, path):
    """Check if the path is safe (no path traversal)."""
    # Handle empty path
    if not path:
        return True
    
    # Normalize the path
    normalized_path = os.path.normpath(path)
    
    # Check for path traversal attempts
    if normalized_path.startswith('..') or '..' in normalized_path.split(os.sep):
        return False
    
    # Resolve the absolute path
    resolved_path = os.path.abspath(os.path.join(basedir, normalized_path))
    resolved_basedir = os.path.abspath(basedir)
    
    # Check if the resolved path is within the base directory
    return resolved_path.startswith(resolved_basedir + os.sep) or resolved_path == resolved_basedir

def search_files(regex_pattern, directory='', recursive=False):
    """Search files that match the given regex pattern."""
    matching_files = []
    
    # Clean the directory parameter
    directory = directory.strip() if directory else ''
    
    # Validate the directory path to prevent path traversal
    if not is_safe_path(FILES_ROOT, directory):
        raise ValueError("Invalid directory path")
    
    # Construct the search directory
    search_dir = os.path.join(FILES_ROOT, directory) if directory else FILES_ROOT
    
    # Check if directory exists
    if not os.path.exists(search_dir):
        raise ValueError(f"Directory does not exist: {directory if directory else '(root)'}")
    
    if not os.path.isdir(search_dir):
        raise ValueError(f"Path is not a directory: {directory if directory else '(root)'}")
    
    # Compile the regex pattern
    try:
        pattern = re.compile(regex_pattern)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    # Walk through the directory
    if recursive:
        for root, dirs, files in os.walk(search_dir):
            for filename in files:
                file_path = os.path.join(root, filename)
                if check_file_matches(file_path, pattern):
                    # Get relative path from search_dir
                    rel_path = os.path.relpath(file_path, search_dir)
                    # Normalize path separators to forward slashes for consistency
                    rel_path = rel_path.replace(os.sep, '/')
                    matching_files.append(rel_path)
    else:
        # Only search in the specified directory (not subdirectories)
        try:
            for filename in os.listdir(search_dir):
                file_path = os.path.join(search_dir, filename)
                if os.path.isfile(file_path):
                    if check_file_matches(file_path, pattern):
                        matching_files.append(filename)
        except PermissionError:
            raise ValueError(f"Permission denied accessing directory: {directory if directory else '(root)'}")
    
    return matching_files

def check_file_matches(file_path, pattern):
    """Check if a file's content matches the regex pattern."""
    try:
        # Check file size first
        file_size = os.path.getsize(file_path)
        if file_size > MAX_FILE_SIZE:
            return False
        
        # Try to read the file as text
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return pattern.search(content) is not None
    except Exception:
        # If we can't read the file (binary, permission issues, etc.), skip it
        return False

@app.route('/search', methods=['GET'])
def search():
    """Search files by regex endpoint."""
    try:
        # Get parameters
        regex = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_param = request.args.get('recursive', 'false')
        
        # Parse recursive parameter
        if recursive_param.lower() in ['true', '1', 'yes']:
            recursive = True
        elif recursive_param.lower() in ['false', '0', 'no', '']:
            recursive = False
        else:
            return jsonify({'error': 'Invalid value for recursive parameter. Use true or false.'}), 400
        
        # Validate required parameter
        if not regex:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Perform the search
        try:
            matching_files = search_files(regex, directory, recursive)
            return jsonify({'files': matching_files}), 200
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
    except Exception as e:
        # Log the error for debugging (in production, use proper logging)
        app.logger.error(f"Internal server error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=False)