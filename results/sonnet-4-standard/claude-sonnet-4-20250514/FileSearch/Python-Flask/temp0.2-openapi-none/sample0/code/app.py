from flask import Flask, request, jsonify
import os
import fnmatch

app = Flask(__name__)

DATA_DIR = "/data"

def search_files_by_content(content, search_dir=None):
    """Search for files containing specific content"""
    matching_files = []
    base_path = DATA_DIR
    
    if search_dir:
        # Remove leading slash if present and join with DATA_DIR
        search_dir = search_dir.lstrip('/')
        base_path = os.path.join(DATA_DIR, search_dir)
    
    if not os.path.exists(base_path):
        return matching_files
    
    for root, dirs, files in os.walk(base_path):
        for file in files:
            file_path = os.path.join(root, file)
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    file_content = f.read()
                    if content in file_content:
                        matching_files.append(file_path)
            except (IOError, OSError):
                # Skip files that can't be read
                continue
    
    return matching_files

def search_files_by_filename(filename, search_dir=None):
    """Search for files matching filename pattern"""
    matching_files = []
    base_path = DATA_DIR
    
    if search_dir:
        # Remove leading slash if present and join with DATA_DIR
        search_dir = search_dir.lstrip('/')
        base_path = os.path.join(DATA_DIR, search_dir)
    
    if not os.path.exists(base_path):
        return matching_files
    
    for root, dirs, files in os.walk(base_path):
        for file in files:
            if fnmatch.fnmatch(file, filename + '*'):
                file_path = os.path.join(root, file)
                matching_files.append(file_path)
    
    return matching_files

@app.route('/search', methods=['POST'])
def search_files():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # At least one search parameter must be provided
        if not search_content and not search_filename:
            return jsonify({"error": "Either search_content or search_filename must be provided"}), 400
        
        matching_files = []
        
        # Search by content if provided
        if search_content:
            content_matches = search_files_by_content(search_content, search_dir)
            matching_files.extend(content_matches)
        
        # Search by filename if provided
        if search_filename:
            filename_matches = search_files_by_filename(search_filename, search_dir)
            matching_files.extend(filename_matches)
        
        # Remove duplicates while preserving order
        unique_files = []
        seen = set()
        for file_path in matching_files:
            if file_path not in seen:
                unique_files.append(file_path)
                seen.add(file_path)
        
        return jsonify({"files": unique_files})
    
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)