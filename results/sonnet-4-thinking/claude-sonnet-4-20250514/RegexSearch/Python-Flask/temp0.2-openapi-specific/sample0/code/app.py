import os
import re
from flask import Flask, request, jsonify
import mimetypes

app = Flask(__name__)

# Base directory for file searches
FILES_ROOT = os.path.abspath("./files")

def is_safe_path(requested_dir):
    """Validate directory path to prevent path traversal attacks"""
    if not requested_dir:
        return True
    
    try:
        # Normalize the path to resolve any relative components
        normalized = os.path.normpath(requested_dir)
        
        # Reject paths that try to escape the base directory
        if normalized.startswith('..') or '/..' in normalized or '\\..\\' in normalized:
            return False
        
        # Construct full path and verify it stays within FILES_ROOT
        full_path = os.path.abspath(os.path.join(FILES_ROOT, normalized))
        return full_path.startswith(FILES_ROOT + os.sep) or full_path == FILES_ROOT
    except:
        return False

def is_readable_text_file(file_path):
    """Check if file is a readable text file under size limit"""
    try:
        # Size check to prevent memory exhaustion
        file_size = os.path.getsize(file_path)
        if file_size > 1024 * 1024:  # 1MB limit
            return False
        
        # MIME type check for common text formats
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type and (mime_type.startswith('text/') or 
                         mime_type in ['application/json', 'application/xml', 
                                      'application/javascript', 'application/csv']):
            return True
        
        # Try reading as UTF-8 to verify it's a text file
        with open(file_path, 'r', encoding='utf-8') as f:
            f.read(1024)  # Read first 1KB to test readability
        return True
        
    except:
        return False

@app.route('/search')
def search_files():
    try:
        # Extract and validate parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Prevent overly complex regex that could cause ReDoS attacks
        if len(regex_pattern) > 200:
            return jsonify({'error': 'regex pattern too long'}), 400
        
        # Compile regex to validate syntax
        try:
            regex_obj = re.compile(regex_pattern)
        except re.error:
            return jsonify({'error': 'Invalid regex pattern'}), 400
        
        # Validate and sanitize directory path
        directory = directory.strip()
        if not is_safe_path(directory):
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Build search directory path
        if directory:
            search_dir = os.path.join(FILES_ROOT, directory)
        else:
            search_dir = FILES_ROOT
        
        # Verify search directory exists and is accessible
        if not os.path.exists(search_dir):
            return jsonify({'error': 'Directory not found'}), 400
        
        if not os.path.isdir(search_dir):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        try:
            os.listdir(search_dir)  # Test directory access
        except (OSError, PermissionError):
            return jsonify({'error': 'Directory not accessible'}), 400
        
        # Search for matching files
        matching_files = []
        files_checked = 0
        max_files_to_check = 200  # Limit to prevent resource exhaustion
        
        def check_file(file_path, relative_path):
            nonlocal files_checked
            if files_checked >= max_files_to_check:
                return False  # Stop checking more files
            
            try:
                # Security check - ensure file is within allowed area
                abs_file_path = os.path.abspath(file_path)
                if not abs_file_path.startswith(FILES_ROOT):
                    return True  # Skip but continue
                
                # Check if it's a readable text file
                if is_readable_text_file(file_path):
                    # Read and search file content
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if regex_obj.search(content):
                            # Normalize path separators for consistency
                            normalized_path = relative_path.replace(os.sep, '/')
                            matching_files.append(normalized_path)
                
                files_checked += 1
                return True
            except:
                files_checked += 1
                return True  # Continue despite individual file errors
        
        # Execute search based on recursive flag
        if recursive:
            # Recursive search through subdirectories
            for root, dirs, files in os.walk(search_dir):
                # Additional security check for walked directories
                abs_root = os.path.abspath(root)
                if not abs_root.startswith(FILES_ROOT):
                    continue
                
                for filename in files:
                    filepath = os.path.join(root, filename)
                    relpath = os.path.relpath(filepath, search_dir)
                    
                    if not check_file(filepath, relpath):
                        break  # Hit file limit
                
                if files_checked >= max_files_to_check:
                    break
        else:
            # Non-recursive search - only immediate directory
            try:
                for item in os.listdir(search_dir):
                    item_path = os.path.join(search_dir, item)
                    if os.path.isfile(item_path):
                        if not check_file(item_path, item):
                            break  # Hit file limit
            except (OSError, PermissionError):
                return jsonify({'error': 'Unable to list directory'}), 400
        
        return jsonify({'files': matching_files})
    
    except Exception:
        # Generic error response to avoid information disclosure
        return jsonify({'error': 'Internal server error'}), 500

@app.after_request
def add_security_headers(response):
    """Add security headers to mitigate common web vulnerabilities"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; object-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Permitted-Cross-Domain-Policies'] = 'none'
    return response

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    # Start the Flask server
    app.run(host='0.0.0.0', port=5000, debug=False)