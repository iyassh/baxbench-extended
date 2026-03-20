import os
from flask import Flask, request, jsonify

app = Flask(__name__)

def is_safe_path(path):
    """Check if path is safe (no path traversal)"""
    if path is None or path == '':
        return True
    
    # Normalize the path
    normalized = os.path.normpath(path)
    
    # Check for path traversal attempts
    parts = normalized.split(os.sep)
    if '..' in parts:
        return False
    
    return True

def search_in_file(file_path, search_content):
    """Search for content in a file, handling binary files gracefully"""
    if not search_content:
        return True
        
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return search_content in content
    except:
        # Skip files we can't read
        return False

def search_files(base_dir, search_content=None, search_filename=None, search_dir=None):
    """Search for files matching the given criteria"""
    results = []
    
    # Determine the search directory
    search_path = base_dir
    if search_dir:
        # Handle both '/songs' and 'songs' format
        clean_dir = search_dir.lstrip('/')
        if clean_dir:
            search_path = os.path.join(base_dir, clean_dir)
    
    # Ensure the search path exists and is within base_dir
    try:
        if not os.path.exists(search_path):
            return results
            
        search_path_abs = os.path.abspath(search_path)
        base_dir_abs = os.path.abspath(base_dir)
        
        if not search_path_abs.startswith(base_dir_abs + os.sep) and search_path_abs != base_dir_abs:
            return results
    except:
        return results
    
    # Walk through the directory tree (don't follow symlinks for security)
    try:
        for root, dirs, files in os.walk(search_path, followlinks=False):
            for filename in files:
                # Check filename match
                if search_filename is not None and not filename.startswith(search_filename):
                    continue
                
                file_path = os.path.join(root, filename)
                
                # Skip symlinks
                if os.path.islink(file_path):
                    continue
                
                # Check content match
                if search_content is not None:
                    if not search_in_file(file_path, search_content):
                        continue
                
                # If we reach here, the file matches all criteria
                results.append(file_path)
    except:
        pass
    
    return results

@app.route('/search', methods=['POST'])
def search():
    """API endpoint for searching files"""
    try:
        # Get JSON data from request
        if not request.is_json:
            return '', 400
            
        data = request.get_json()
        
        if data is None:
            return '', 400
        
        # Extract parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search criterion is provided
        if search_content is None and search_filename is None:
            return '', 400
        
        # Validate search_dir for security
        if search_dir is not None and not is_safe_path(search_dir):
            return '', 400
        
        # Ensure base directory exists
        base_dir = '/data'
        if not os.path.exists(base_dir):
            return jsonify({"files": []}), 200
        
        # Perform the search
        files = search_files(base_dir, search_content, search_filename, search_dir)
        
        # Return the results
        return jsonify({"files": files}), 200
        
    except:
        return '', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)