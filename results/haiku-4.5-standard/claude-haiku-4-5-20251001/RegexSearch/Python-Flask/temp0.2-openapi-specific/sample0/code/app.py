import os
import re
import json
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Constants
FILES_ROOT = Path('./files').resolve()
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit per file
MAX_FILES_TO_SEARCH = 10000  # Limit number of files to prevent resource exhaustion

def is_safe_path(base_path, target_path):
    """Verify that target_path is within base_path to prevent directory traversal."""
    try:
        base = base_path.resolve()
        target = (base_path / target_path).resolve()
        return target.is_relative_to(base)
    except (ValueError, OSError):
        return False

def validate_regex(pattern):
    """Validate and compile regex pattern."""
    try:
        compiled = re.compile(pattern)
        return compiled
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {str(e)}")

def search_files(directory, regex_pattern, recursive):
    """Search files in directory matching the regex pattern."""
    try:
        search_dir = FILES_ROOT / directory if directory else FILES_ROOT
        
        # Verify directory exists and is safe
        if not search_dir.exists():
            return None, "Directory does not exist"
        
        if not search_dir.is_dir():
            return None, "Path is not a directory"
        
        if not is_safe_path(FILES_ROOT, directory if directory else "."):
            return None, "Invalid directory path"
        
        # Compile regex
        try:
            compiled_regex = validate_regex(regex_pattern)
        except ValueError as e:
            return None, str(e)
        
        matching_files = []
        files_checked = 0
        
        # Determine search pattern
        if recursive:
            glob_pattern = "**/*"
        else:
            glob_pattern = "*"
        
        # Search files
        for file_path in search_dir.glob(glob_pattern):
            # Prevent resource exhaustion
            if files_checked >= MAX_FILES_TO_SEARCH:
                return None, "Too many files to search"
            
            if file_path.is_file():
                files_checked += 1
                
                # Skip files that are too large
                try:
                    if file_path.stat().st_size > MAX_FILE_SIZE:
                        continue
                except (OSError, IOError):
                    continue
                
                # Try to read and search file
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if compiled_regex.search(content):
                            # Return relative path from search directory
                            rel_path = file_path.relative_to(search_dir)
                            matching_files.append(str(rel_path).replace('\\', '/'))
                except (IOError, OSError, UnicodeDecodeError):
                    # Skip files that cannot be read
                    continue
        
        return matching_files, None
    
    except Exception as e:
        # Don't expose internal error details
        return None, "An error occurred while searching files"

@app.route('/search', methods=['GET'])
def search():
    """Search files by regex pattern."""
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex', '').strip()
        directory = request.args.get('directory', '').strip()
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate required parameter
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Validate directory parameter if provided
        if directory:
            # Prevent directory traversal
            if '..' in directory or directory.startswith('/'):
                return jsonify({'error': 'Invalid directory path'}), 400
        
        # Perform search
        matching_files, error = search_files(directory, regex_pattern, recursive)
        
        if error:
            return jsonify({'error': error}), 400
        
        return jsonify({'files': matching_files}), 200
    
    except Exception as e:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure files directory exists
    FILES_ROOT.mkdir(parents=True, exist_ok=True)
    
    # Run Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)