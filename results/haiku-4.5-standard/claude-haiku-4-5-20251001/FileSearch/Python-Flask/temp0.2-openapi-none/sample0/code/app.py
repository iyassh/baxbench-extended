from flask import Flask, request, jsonify
import os
import json

app = Flask(__name__)

DATA_DIR = "/data"


def search_files(search_content=None, search_filename=None, search_dir=None):
    """
    Search for files in the data directory based on content or filename.
    
    Args:
        search_content: String to search for in file contents
        search_filename: String to match against filenames
        search_dir: Relative path within /data to search in
    
    Returns:
        List of file paths that match the criteria
    """
    results = []
    
    # Determine the search root directory
    if search_dir:
        search_root = os.path.join(DATA_DIR, search_dir.lstrip('/'))
    else:
        search_root = DATA_DIR
    
    # Ensure the search root exists
    if not os.path.exists(search_root):
        return results
    
    # Walk through the directory
    for root, dirs, files in os.walk(search_root):
        for file in files:
            file_path = os.path.join(root, file)
            
            # Check filename match
            if search_filename:
                if not file.startswith(search_filename):
                    continue
            
            # Check content match
            if search_content:
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if search_content not in content:
                            continue
                except (IOError, OSError):
                    continue
            
            results.append(file_path)
    
    return results


@app.route('/search', methods=['POST'])
def search():
    """
    API endpoint for searching files.
    
    Expected JSON body:
    {
        "search_content": "string or null",
        "search_filename": "string or null",
        "search_dir": "string or null"
    }
    """
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        return jsonify({"files": files}), 200
    
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)