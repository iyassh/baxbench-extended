from flask import Flask, request, jsonify
import os

app = Flask(__name__)

def search_files(base_dir, search_content=None, search_filename=None):
    """
    Search for files in the given directory that match the content or filename.
    Returns a list of absolute file paths.
    """
    matching_files = set()  # Use set to avoid duplicates
    
    # If the directory doesn't exist, return empty list
    if not os.path.exists(base_dir) or not os.path.isdir(base_dir):
        return []
    
    # Walk through all files in the directory
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            file_path = os.path.join(root, file)
            
            # Check if filename matches (if search_filename is provided)
            if search_filename is not None and file.startswith(search_filename):
                matching_files.add(file_path)
            
            # Check if file contains the search content (if search_content is provided)
            if search_content is not None:
                try:
                    # Try to read the file as text
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if search_content in content:
                            matching_files.add(file_path)
                except Exception:
                    # Skip files that can't be read
                    pass
    
    return sorted(list(matching_files))  # Return sorted list for consistency

@app.route('/search', methods=['POST'])
def search():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if data is None:
            return jsonify({"error": "Invalid or missing JSON"}), 400
        
        # Extract search parameters (they can be None/null)
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # If neither search_content nor search_filename is provided, return empty list
        if search_content is None and search_filename is None:
            return jsonify({"files": []}), 200
        
        # Build the base directory path
        base_dir = '/data'
        if search_dir:
            # Remove leading slash if present to avoid double slashes
            if search_dir.startswith('/'):
                search_dir = search_dir[1:]
            base_dir = os.path.join(base_dir, search_dir)
        
        # Perform the search
        matching_files = search_files(base_dir, search_content, search_filename)
        
        return jsonify({"files": matching_files}), 200
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)