from flask import Flask, request, jsonify
import os
import re
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.ERROR)
app.logger.setLevel(logging.ERROR)

# Constants
FILES_ROOT = os.path.abspath("./files")
MAX_FILES_TO_SEARCH = 1000
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_REGEX_LENGTH = 1000

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)

def validate_directory_path(directory):
    """Validate directory path to prevent path traversal"""
    if directory is None or directory == "":
        return FILES_ROOT
    
    # Remove any leading/trailing slashes and normalize
    directory = directory.strip('/')
    
    # Check for path traversal attempts
    if '..' in directory or directory.startswith('/') or ':' in directory:
        return None
    
    # Construct absolute path and verify it's within FILES_ROOT
    abs_path = os.path.abspath(os.path.join(FILES_ROOT, directory))
    
    # Ensure the resolved path is within FILES_ROOT
    if not abs_path.startswith(FILES_ROOT):
        return None
        
    return abs_path

def validate_regex(regex_pattern):
    """Validate regex pattern"""
    if not regex_pattern:
        return False, "Regex pattern is required"
    
    if len(regex_pattern) > MAX_REGEX_LENGTH:
        return False, "Regex pattern too long"
    
    try:
        # Compile regex to validate it
        re.compile(regex_pattern)
        return True, None
    except re.error:
        return False, "Invalid regex pattern"

def search_files(directory, regex_pattern, recursive):
    """Search files matching regex in content"""
    matching_files = []
    files_searched = 0
    
    try:
        compiled_regex = re.compile(regex_pattern)
        
        if recursive:
            # Walk through all subdirectories
            for root, dirs, files in os.walk(directory):
                for filename in files:
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break
                        
                    filepath = os.path.join(root, filename)
                    
                    # Skip if not a regular file
                    if not os.path.isfile(filepath):
                        continue
                    
                    # Check file size
                    try:
                        if os.path.getsize(filepath) > MAX_FILE_SIZE:
                            continue
                    except OSError:
                        continue
                    
                    files_searched += 1
                    
                    # Try to read and search file
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read(MAX_FILE_SIZE)
                            if compiled_regex.search(content):
                                # Get relative path from search directory
                                rel_path = os.path.relpath(filepath, directory)
                                matching_files.append(rel_path.replace('\\', '/'))
                    except (IOError, OSError):
                        # Skip files that can't be read
                        continue
                
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
        else:
            # Only search in the specified directory
            try:
                for filename in os.listdir(directory):
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break
                        
                    filepath = os.path.join(directory, filename)
                    
                    # Skip if not a regular file
                    if not os.path.isfile(filepath):
                        continue
                    
                    # Check file size
                    try:
                        if os.path.getsize(filepath) > MAX_FILE_SIZE:
                            continue
                    except OSError:
                        continue
                    
                    files_searched += 1
                    
                    # Try to read and search file
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read(MAX_FILE_SIZE)
                            if compiled_regex.search(content):
                                matching_files.append(filename.replace('\\', '/'))
                    except (IOError, OSError):
                        # Skip files that can't be read
                        continue
            except OSError:
                # Directory doesn't exist or can't be accessed
                pass
                
    except Exception:
        # Catch any unexpected errors
        raise
        
    return matching_files

@app.route('/search', methods=['GET'])
def search():
    """Search files by regex"""
    try:
        # Get parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex
        valid, error_msg = validate_regex(regex_pattern)
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        # Validate directory path
        search_directory = validate_directory_path(directory)
        if search_directory is None:
            return jsonify({"error": "Invalid directory path"}), 400
        
        # Check if directory exists
        if not os.path.exists(search_directory):
            return jsonify({"error": "Directory not found"}), 400
        
        # Perform search
        matching_files = search_files(search_directory, regex_pattern, recursive)
        
        return jsonify({"files": matching_files}), 200
        
    except Exception:
        # Log the error internally but don't expose details
        app.logger.error("Internal error during search", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    """Handle 405 errors"""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors"""
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    if not os.path.exists(FILES_ROOT):
        os.makedirs(FILES_ROOT)
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)