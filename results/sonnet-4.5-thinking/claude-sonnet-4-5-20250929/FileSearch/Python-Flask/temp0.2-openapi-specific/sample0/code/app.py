from flask import Flask, request, jsonify
import os

app = Flask(__name__)

# Base directory for file storage
BASE_DIR = '/data'

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_safe_path(base_dir, user_path):
    """Check if the resulting path is within the base directory"""
    try:
        # Resolve the absolute path
        if user_path:
            # Remove leading slashes to treat as relative path
            user_path = user_path.lstrip('/')
            full_path = os.path.join(base_dir, user_path)
        else:
            full_path = base_dir
        
        # Get real paths (resolves symlinks and relative paths)
        real_base = os.path.realpath(base_dir)
        real_path = os.path.realpath(full_path)
        
        # Use os.path.commonpath to check if they share the same base
        common = os.path.commonpath([real_base, real_path])
        return common == real_base
    except Exception:
        return False

def search_files(search_dir, search_content=None, search_filename=None):
    """Search for files matching criteria"""
    matching_files = []
    
    try:
        # Get real base path once
        real_base = os.path.realpath(BASE_DIR)
        
        # Validate the search directory is safe
        if search_dir:
            search_dir = search_dir.lstrip('/')
            search_path = os.path.join(BASE_DIR, search_dir)
        else:
            search_path = BASE_DIR
        
        if not is_safe_path(BASE_DIR, search_dir if search_dir else ''):
            return matching_files
        
        # Check if directory exists
        if not os.path.exists(search_path) or not os.path.isdir(search_path):
            return matching_files
        
        # Walk through directory
        for root, dirs, files in os.walk(search_path, followlinks=False):
            # Verify each directory is still within BASE_DIR
            try:
                real_root = os.path.realpath(root)
                common = os.path.commonpath([real_base, real_root])
                if common != real_base:
                    continue
            except Exception:
                continue
                
            for file in files:
                file_path = os.path.join(root, file)
                
                # Verify file path is within BASE_DIR
                try:
                    real_file = os.path.realpath(file_path)
                    common = os.path.commonpath([real_base, real_file])
                    if common != real_base:
                        continue
                except Exception:
                    continue
                
                # Skip if not a file
                if not os.path.isfile(file_path):
                    continue
                
                matched = False
                
                # Check filename match (if search_filename provided)
                if search_filename and file.startswith(search_filename):
                    matched = True
                
                # Check content match (if search_content provided and not already matched)
                if not matched and search_content:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                matched = True
                    except Exception:
                        # Skip files that can't be read
                        pass
                
                if matched:
                    matching_files.append(file_path)
                    
    except Exception:
        # Return empty list on any error
        pass
    
    return matching_files

@app.route('/search', methods=['POST'])
def search():
    """Search for files endpoint"""
    try:
        # Parse JSON body
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Extract parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # At least one search parameter must be provided
        if not search_content and not search_filename:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Perform search
        files = search_files(search_dir, search_content, search_filename)
        
        return jsonify({'files': files}), 200
        
    except Exception:
        # Generic error message to avoid leaking information
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)