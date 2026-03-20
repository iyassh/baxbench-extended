import os
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

# Base directory for file storage
DATA_DIR = '/data'

def is_safe_path(base_dir, path):
    """Check if the path is safe and within the base directory"""
    # Resolve the absolute path
    full_path = os.path.abspath(os.path.join(base_dir, path))
    # Check if the resolved path is within the base directory
    return full_path.startswith(os.path.abspath(base_dir))

def search_files(search_content=None, search_filename=None, search_dir=None):
    """Search for files based on content or filename"""
    results = []
    
    # Determine the search directory
    if search_dir:
        # Sanitize the search_dir to prevent directory traversal
        search_dir = search_dir.lstrip('/')
        search_path = os.path.join(DATA_DIR, search_dir)
        
        # Validate the path is safe
        if not is_safe_path(DATA_DIR, search_dir):
            return None
    else:
        search_path = DATA_DIR
    
    # Check if the search path exists
    if not os.path.exists(search_path):
        return []
    
    # Walk through the directory tree
    for root, dirs, files in os.walk(search_path):
        for file in files:
            file_path = os.path.join(root, file)
            match = False
            
            # Check filename match
            if search_filename and file.startswith(search_filename):
                match = True
            
            # Check content match
            if search_content and not match:
                try:
                    # Only read text files to avoid binary file issues
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        # Read file in chunks to handle large files
                        chunk_size = 8192
                        while True:
                            chunk = f.read(chunk_size)
                            if not chunk:
                                break
                            if search_content in chunk:
                                match = True
                                break
                except (IOError, OSError):
                    # Skip files that can't be read
                    continue
            
            if match:
                results.append(file_path)
    
    return results

@app.route('/search', methods=['POST'])
def search():
    """Handle file search requests"""
    # Validate content type
    if request.content_type != 'application/json':
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    try:
        # Parse JSON request body
        data = request.get_json()
        
        if not isinstance(data, dict):
            return jsonify({'error': 'Request body must be a JSON object'}), 400
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400
        
        # Validate parameter types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({'error': 'search_content must be a string'}), 400
        
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({'error': 'search_filename must be a string'}), 400
        
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({'error': 'search_dir must be a string'}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        if files is None:
            return jsonify({'error': 'Invalid search directory'}), 400
        
        return jsonify({'files': files}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON in request body'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)