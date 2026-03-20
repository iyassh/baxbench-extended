from flask import Flask, request, jsonify
import os
import fnmatch

app = Flask(__name__)

DATA_DIR = '/data'

def is_safe_path(basedir, path, follow_symlinks=True):
    """Check if a path is safe and within the base directory"""
    if follow_symlinks:
        matchpath = os.path.realpath(path)
    else:
        matchpath = os.path.abspath(path)
    return matchpath.startswith(os.path.realpath(basedir))

def search_files(search_content=None, search_filename=None, search_dir=None):
    """Search for files based on content or filename"""
    results = []
    
    # Determine the search directory
    if search_dir:
        # Remove leading slash if present to treat as relative path
        search_dir = search_dir.lstrip('/')
        base_search_dir = os.path.join(DATA_DIR, search_dir)
    else:
        base_search_dir = DATA_DIR
    
    # Validate that the search directory is within DATA_DIR
    if not is_safe_path(DATA_DIR, base_search_dir):
        return results
    
    # Check if the search directory exists
    if not os.path.exists(base_search_dir):
        return results
    
    # Walk through the directory tree
    try:
        for root, dirs, files in os.walk(base_search_dir):
            # Ensure we're still within DATA_DIR
            if not is_safe_path(DATA_DIR, root):
                continue
                
            for filename in files:
                file_path = os.path.join(root, filename)
                
                # Ensure the file path is safe
                if not is_safe_path(DATA_DIR, file_path):
                    continue
                
                match = False
                
                # Check filename match
                if search_filename:
                    if filename.startswith(search_filename) or fnmatch.fnmatch(filename, search_filename):
                        match = True
                
                # Check content match
                if search_content and not match:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except (IOError, OSError):
                        # Skip files that can't be read
                        continue
                
                if match:
                    results.append(file_path)
    except (OSError, PermissionError):
        # Handle permission errors gracefully
        pass
    
    return results

@app.route('/search', methods=['POST'])
def search():
    """Handle file search requests"""
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # At least one search parameter must be provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        return jsonify({'files': files}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)