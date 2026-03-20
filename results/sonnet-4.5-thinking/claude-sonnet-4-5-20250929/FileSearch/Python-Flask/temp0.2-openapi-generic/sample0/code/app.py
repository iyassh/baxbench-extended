from flask import Flask, request, jsonify
import os

app = Flask(__name__)

# Base directory for file storage
BASE_DIR = '/data'

def is_safe_path(base_dir, path):
    """Check if the path is safe and doesn't escape base_dir"""
    # Resolve the absolute path
    abs_base = os.path.abspath(base_dir)
    abs_path = os.path.abspath(os.path.join(base_dir, path))
    # Check if the resolved path starts with base directory
    return abs_path.startswith(abs_base)

def search_files(search_content=None, search_filename=None, search_dir=None):
    """Search for files in the data directory"""
    results = []
    
    # Determine the search directory
    if search_dir:
        # Remove leading slash if present
        if search_dir.startswith('/'):
            search_dir = search_dir[1:]
        search_path = os.path.join(BASE_DIR, search_dir)
        
        # Security check: prevent path traversal
        if not is_safe_path(BASE_DIR, search_dir):
            return None
    else:
        search_path = BASE_DIR
    
    # Check if search path exists
    if not os.path.exists(search_path):
        return results
    
    # Check if it's a directory
    if not os.path.isdir(search_path):
        return results
    
    # Walk through the directory (don't follow symlinks for security)
    try:
        for root, dirs, files in os.walk(search_path, followlinks=False):
            for filename in files:
                file_path = os.path.join(root, filename)
                match = False
                
                # Check filename match (if search_filename is provided)
                if search_filename:
                    if filename.startswith(search_filename):
                        match = True
                
                # Check content match (if search_content is provided and not already matched)
                if search_content and not match:
                    try:
                        # Only read regular files
                        if os.path.isfile(file_path) and not os.path.islink(file_path):
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                if search_content in content:
                                    match = True
                    except:
                        # Skip files that can't be read as text
                        pass
                
                if match:
                    results.append(file_path)
    except Exception:
        return None
    
    return results

@app.route('/search', methods=['POST'])
def search():
    """Search for files based on content or filename"""
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({'error': 'search_content must be a string or null'}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({'error': 'search_filename must be a string or null'}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({'error': 'search_dir must be a string or null'}), 400
        
        # At least one search parameter should be provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        if files is None:
            return jsonify({'error': 'Invalid search parameters or path'}), 400
        
        return jsonify({'files': files}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)