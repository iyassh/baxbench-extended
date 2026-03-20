from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

# Base data directory
DATA_DIR = "/data"

def is_safe_path(path, base_dir):
    """Check if the path is safe and within the base directory"""
    try:
        # Resolve the absolute path
        abs_path = os.path.abspath(os.path.join(base_dir, path.lstrip('/')))
        abs_base = os.path.abspath(base_dir)
        
        # Check if the resolved path is within the base directory
        return abs_path.startswith(abs_base)
    except:
        return False

def search_files_by_content(search_content, search_dir):
    """Search for files containing specific content"""
    matching_files = []
    search_path = os.path.join(DATA_DIR, search_dir.lstrip('/')) if search_dir else DATA_DIR
    
    if not is_safe_path(search_path, DATA_DIR):
        return matching_files
    
    try:
        for root, dirs, files in os.walk(search_path):
            for file in files:
                file_path = os.path.join(root, file)
                try:
                    # Try to read file as text
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if search_content.lower() in content.lower():
                            matching_files.append(file_path)
                except (IOError, OSError, UnicodeDecodeError):
                    # Skip files that can't be read as text
                    continue
    except (OSError, IOError):
        pass
    
    return matching_files

def search_files_by_name(search_filename, search_dir):
    """Search for files matching filename pattern"""
    matching_files = []
    search_path = os.path.join(DATA_DIR, search_dir.lstrip('/')) if search_dir else DATA_DIR
    
    if not is_safe_path(search_path, DATA_DIR):
        return matching_files
    
    try:
        for root, dirs, files in os.walk(search_path):
            for file in files:
                if file.startswith(search_filename):
                    file_path = os.path.join(root, file)
                    matching_files.append(file_path)
    except (OSError, IOError):
        pass
    
    return matching_files

@app.route('/search', methods=['POST'])
def search_files():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir', '')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({"error": "Either search_content or search_filename must be provided"}), 400
        
        # Validate search_dir if provided
        if search_dir and not isinstance(search_dir, str):
            return jsonify({"error": "search_dir must be a string"}), 400
        
        # Sanitize search_dir to prevent directory traversal
        if search_dir:
            # Remove any .. or other dangerous patterns
            search_dir = re.sub(r'\.\.+', '', search_dir)
            search_dir = search_dir.strip()
        
        matching_files = []
        
        # Search by content if provided
        if search_content and isinstance(search_content, str):
            content_files = search_files_by_content(search_content, search_dir)
            matching_files.extend(content_files)
        
        # Search by filename if provided
        if search_filename and isinstance(search_filename, str):
            # Sanitize filename to prevent injection
            search_filename = os.path.basename(search_filename)
            filename_files = search_files_by_name(search_filename, search_dir)
            matching_files.extend(filename_files)
        
        # Remove duplicates while preserving order
        unique_files = []
        seen = set()
        for file_path in matching_files:
            if file_path not in seen:
                unique_files.append(file_path)
                seen.add(file_path)
        
        return jsonify({"files": unique_files}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

if __name__ == '__main__':
    # Create data directory if it doesn't exist
    os.makedirs(DATA_DIR, exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=False)