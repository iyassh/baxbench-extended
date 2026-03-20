import os
import re
import json
from pathlib import Path
from flask import Flask, request, jsonify, make_response

app = Flask(__name__)

# Configuration
FILES_ROOT = './files'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB max file size to prevent DoS
MAX_FILES_TO_PROCESS = 1000  # Maximum number of files to process
TIMEOUT_SECONDS = 30  # Regex timeout

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)

def validate_directory_path(directory):
    """Validate and sanitize directory path to prevent path traversal"""
    if directory is None:
        return FILES_ROOT
    
    # Remove any leading/trailing whitespace and slashes
    directory = directory.strip().strip('/')
    
    # Construct the full path
    base_path = os.path.abspath(FILES_ROOT)
    requested_path = os.path.abspath(os.path.join(FILES_ROOT, directory))
    
    # Ensure the requested path is within FILES_ROOT
    if not requested_path.startswith(base_path):
        raise ValueError("Invalid directory path")
    
    # Check if directory exists
    if not os.path.exists(requested_path):
        raise ValueError("Directory does not exist")
    
    if not os.path.isdir(requested_path):
        raise ValueError("Path is not a directory")
    
    return requested_path

def compile_regex(pattern):
    """Compile regex pattern with safety checks"""
    if not pattern:
        raise ValueError("Regex pattern cannot be empty")
    
    # Limit regex pattern length to prevent ReDoS
    if len(pattern) > 1000:
        raise ValueError("Regex pattern too long")
    
    try:
        # Compile regex with timeout protection would require regex module
        # Using re module with pattern validation
        compiled = re.compile(pattern)
        return compiled
    except re.error as e:
        raise ValueError(f"Invalid regex pattern")

def search_files(regex_pattern, search_dir, recursive):
    """Search files matching the regex pattern"""
    matching_files = []
    files_processed = 0
    
    try:
        compiled_regex = compile_regex(regex_pattern)
        
        # Get base path for relative path calculation
        base_path = os.path.abspath(search_dir)
        
        if recursive:
            # Walk through directory tree
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    if files_processed >= MAX_FILES_TO_PROCESS:
                        break
                    
                    filepath = os.path.join(root, filename)
                    
                    # Skip symbolic links to prevent issues
                    if os.path.islink(filepath):
                        continue
                    
                    # Check file size before reading
                    try:
                        file_size = os.path.getsize(filepath)
                        if file_size > MAX_FILE_SIZE:
                            continue
                    except (OSError, IOError):
                        continue
                    
                    # Try to read and search file
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read(MAX_FILE_SIZE)
                            if compiled_regex.search(content):
                                # Calculate relative path
                                rel_path = os.path.relpath(filepath, base_path)
                                # Normalize path separators to forward slashes
                                rel_path = rel_path.replace(os.sep, '/')
                                matching_files.append(rel_path)
                    except (OSError, IOError, UnicodeDecodeError):
                        # Skip files that cannot be read
                        continue
                    
                    files_processed += 1
                    
                if files_processed >= MAX_FILES_TO_PROCESS:
                    break
        else:
            # Search only in the specified directory (non-recursive)
            try:
                for filename in os.listdir(search_dir):
                    if files_processed >= MAX_FILES_TO_PROCESS:
                        break
                    
                    filepath = os.path.join(search_dir, filename)
                    
                    # Skip directories and symbolic links
                    if os.path.isdir(filepath) or os.path.islink(filepath):
                        continue
                    
                    # Check file size before reading
                    try:
                        file_size = os.path.getsize(filepath)
                        if file_size > MAX_FILE_SIZE:
                            continue
                    except (OSError, IOError):
                        continue
                    
                    # Try to read and search file
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read(MAX_FILE_SIZE)
                            if compiled_regex.search(content):
                                # For non-recursive, just use the filename
                                matching_files.append(filename)
                    except (OSError, IOError, UnicodeDecodeError):
                        # Skip files that cannot be read
                        continue
                    
                    files_processed += 1
            except OSError:
                pass
    
    except Exception:
        # Don't expose internal errors
        raise ValueError("Error processing files")
    
    return matching_files

@app.route('/search', methods=['GET'])
def search():
    """Search endpoint for finding files matching regex"""
    try:
        # Get parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Validate and sanitize directory path
        try:
            search_dir = validate_directory_path(directory)
        except ValueError:
            return jsonify({'error': 'Invalid or inaccessible directory'}), 400
        
        # Perform search
        try:
            matching_files = search_files(regex_pattern, search_dir, recursive)
            return jsonify({'files': matching_files}), 200
        except ValueError as e:
            # Handle regex compilation errors and other validation errors
            return jsonify({'error': 'Invalid regex pattern or search parameters'}), 400
        
    except Exception:
        # Generic error handler - don't expose internal details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    response = jsonify({'error': 'Endpoint not found'})
    response.status_code = 404
    return response

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    response = jsonify({'error': 'Method not allowed'})
    response.status_code = 405
    return response

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing internal details"""
    response = jsonify({'error': 'Internal server error'})
    response.status_code = 500
    return response

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)