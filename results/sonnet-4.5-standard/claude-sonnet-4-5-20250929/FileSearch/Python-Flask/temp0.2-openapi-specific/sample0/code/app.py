from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

DATA_DIR = '/data'

def normalize_path(path):
    """Normalize and validate path to prevent directory traversal."""
    # Remove any null bytes
    path = path.replace('\0', '')
    
    # Normalize the path
    normalized = os.path.normpath(path)
    
    # Ensure the path doesn't try to escape the data directory
    if normalized.startswith('..') or normalized.startswith('/..'):
        return None
    
    return normalized

def is_safe_path(base_dir, user_path):
    """Check if the resolved path is within the base directory."""
    try:
        # Join and resolve the full path
        full_path = os.path.realpath(os.path.join(base_dir, user_path.lstrip('/')))
        base_path = os.path.realpath(base_dir)
        
        # Check if the full path starts with the base path
        return full_path.startswith(base_path)
    except Exception:
        return False

def search_files(search_content=None, search_filename=None, search_dir=None):
    """Search for files based on content or filename."""
    results = []
    
    # Determine the search directory
    if search_dir:
        # Normalize and validate the search directory
        normalized_dir = normalize_path(search_dir)
        if normalized_dir is None:
            return None, "Invalid search directory"
        
        search_path = os.path.join(DATA_DIR, normalized_dir.lstrip('/'))
        
        # Validate the path is within DATA_DIR
        if not is_safe_path(DATA_DIR, normalized_dir):
            return None, "Invalid search directory"
    else:
        search_path = DATA_DIR
    
    # Check if the search path exists and is a directory
    if not os.path.exists(search_path):
        return results, None
    
    if not os.path.isdir(search_path):
        return results, None
    
    try:
        # Walk through the directory tree
        for root, dirs, files in os.walk(search_path):
            # Ensure we're still within DATA_DIR
            if not os.path.realpath(root).startswith(os.path.realpath(DATA_DIR)):
                continue
            
            for filename in files:
                file_path = os.path.join(root, filename)
                
                # Double-check the file is within DATA_DIR
                if not os.path.realpath(file_path).startswith(os.path.realpath(DATA_DIR)):
                    continue
                
                match = False
                
                # Check filename match
                if search_filename:
                    if filename.startswith(search_filename):
                        match = True
                
                # Check content match
                if search_content and not match:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except Exception:
                        # Skip files that can't be read
                        continue
                
                if match:
                    results.append(file_path)
    except Exception:
        return None, "Error during search"
    
    return results, None

@app.route('/search', methods=['POST'])
def search():
    """Handle file search requests."""
    try:
        # Parse JSON request
        data = request.get_json(silent=True)
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Extract parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({"error": "At least one search parameter required"}), 400
        
        # Perform the search
        files, error = search_files(search_content, search_filename, search_dir)
        
        if error:
            return jsonify({"error": "Invalid request"}), 400
        
        return jsonify({"files": files}), 200
        
    except Exception:
        return jsonify({"error": "Invalid request"}), 400

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)