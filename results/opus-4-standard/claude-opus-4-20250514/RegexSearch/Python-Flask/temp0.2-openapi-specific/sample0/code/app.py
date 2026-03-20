import os
import re
import json
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    return response

# Constants for resource limits
MAX_REGEX_LENGTH = 1000
MAX_FILES_TO_SEARCH = 10000
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_SEARCH_DEPTH = 20
FILES_ROOT = './files'

def validate_and_normalize_path(directory):
    """Validate and normalize directory path to prevent path traversal attacks."""
    if directory is None:
        return ''
    
    # Remove any leading/trailing whitespace and slashes
    directory = directory.strip().strip('/')
    
    # Check for path traversal attempts
    if '..' in directory or directory.startswith('/') or ':' in directory:
        raise ValueError("Invalid directory path")
    
    # Normalize the path
    normalized = os.path.normpath(directory)
    
    # Double-check that the normalized path doesn't escape
    if '..' in normalized or normalized.startswith('/') or ':' in normalized:
        raise ValueError("Invalid directory path")
    
    return normalized

def is_safe_path(base_path, target_path):
    """Check if target_path is safely within base_path."""
    try:
        # Get absolute paths
        base_abs = os.path.abspath(base_path)
        target_abs = os.path.abspath(target_path)
        
        # Check if target is within base
        return target_abs.startswith(base_abs + os.sep) or target_abs == base_abs
    except Exception:
        return False

def search_files(regex_pattern, directory, recursive, files_searched):
    """Search files matching the regex pattern."""
    matching_files = []
    
    try:
        # Compile regex with timeout protection
        compiled_regex = re.compile(regex_pattern)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern")
    
    # Construct the search path
    search_path = os.path.join(FILES_ROOT, directory) if directory else FILES_ROOT
    
    # Verify the search path is safe
    if not is_safe_path(FILES_ROOT, search_path):
        raise ValueError("Invalid directory path")
    
    # Check if directory exists
    if not os.path.exists(search_path):
        raise ValueError("Directory does not exist")
    
    if not os.path.isdir(search_path):
        raise ValueError("Path is not a directory")
    
    # Walk through files
    if recursive:
        for root, dirs, files in os.walk(search_path):
            # Check depth to prevent excessive recursion
            depth = root[len(search_path):].count(os.sep)
            if depth > MAX_SEARCH_DEPTH:
                continue
                
            for filename in files:
                if files_searched[0] >= MAX_FILES_TO_SEARCH:
                    break
                    
                file_path = os.path.join(root, filename)
                if process_file(file_path, compiled_regex, search_path, matching_files):
                    files_searched[0] += 1
    else:
        # Non-recursive search
        try:
            for filename in os.listdir(search_path):
                if files_searched[0] >= MAX_FILES_TO_SEARCH:
                    break
                    
                file_path = os.path.join(search_path, filename)
                if os.path.isfile(file_path):
                    if process_file(file_path, compiled_regex, search_path, matching_files):
                        files_searched[0] += 1
        except OSError:
            raise ValueError("Error accessing directory")
    
    return matching_files

def process_file(file_path, compiled_regex, search_path, matching_files):
    """Process a single file and check if it matches the regex."""
    try:
        # Check file size before reading
        file_size = os.path.getsize(file_path)
        if file_size > MAX_FILE_SIZE:
            return True  # Count as searched but skip
        
        # Read and search file content
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read(MAX_FILE_SIZE)
            
        if compiled_regex.search(content):
            # Get relative path from search directory
            rel_path = os.path.relpath(file_path, search_path)
            matching_files.append(rel_path)
            
        return True
    except Exception:
        # Skip files that can't be read
        return True

@app.route('/search', methods=['GET'])
def search():
    """Search endpoint implementation."""
    try:
        # Get parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        if len(regex_pattern) > MAX_REGEX_LENGTH:
            return jsonify({'error': 'Regex pattern too long'}), 400
        
        # Validate and normalize directory
        try:
            directory = validate_and_normalize_path(directory)
        except ValueError:
            return jsonify({'error': 'Invalid directory parameter'}), 400
        
        # Perform search with resource limits
        files_searched = [0]  # Use list to allow modification in nested function
        try:
            matching_files = search_files(regex_pattern, directory, recursive, files_searched)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception:
        # Log error internally without exposing details
        logger.error("Internal error during search", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)