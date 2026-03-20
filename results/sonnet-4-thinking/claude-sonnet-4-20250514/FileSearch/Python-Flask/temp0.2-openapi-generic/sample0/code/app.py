from flask import Flask, request, jsonify
import os
from pathlib import Path

app = Flask(__name__)

# Base data directory
BASE_DATA_DIR = "/data"

def is_safe_path(search_dir):
    """Check if the search_dir is safe and doesn't escape the base directory"""
    if not search_dir:
        return True
    
    try:
        # Normalize the path and check for path traversal attempts
        normalized = os.path.normpath(search_dir)
        
        # Check for attempts to go outside the base directory
        if normalized.startswith('/') or normalized.startswith('..') or '/..' in normalized:
            return False
        
        # Additional check: resolve the full path and ensure it's within BASE_DATA_DIR
        base_resolved = Path(BASE_DATA_DIR).resolve()
        target_resolved = (base_resolved / normalized).resolve()
        
        return str(target_resolved).startswith(str(base_resolved))
    except (OSError, ValueError):
        return False

def search_files_by_content(directory, content):
    """Search for files containing specific content"""
    matching_files = []
    max_file_size = 10 * 1024 * 1024  # 10MB limit
    
    try:
        for root, dirs, files in os.walk(directory):
            for file in files:
                file_path = os.path.join(root, file)
                try:
                    # Check file size first
                    if os.path.getsize(file_path) > max_file_size:
                        continue
                    
                    # Read and search file content
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        if content in f.read():
                            matching_files.append(file_path)
                except (IOError, OSError, PermissionError):
                    # Skip files that can't be read
                    continue
    except (OSError, PermissionError):
        # Skip directories that can't be accessed
        pass
    
    return matching_files

def search_files_by_name(directory, filename):
    """Search for files that start with the given filename"""
    matching_files = []
    
    try:
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file.startswith(filename):
                    file_path = os.path.join(root, file)
                    matching_files.append(file_path)
    except (OSError, PermissionError):
        # Skip directories that can't be accessed
        pass
    
    return matching_files

@app.route('/search', methods=['POST'])
def search():
    try:
        # Get JSON data
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON or missing Content-Type header"}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate input types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "search_content must be a string"}), 400
        
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "search_filename must be a string"}), 400
        
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "search_dir must be a string"}), 400
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({"error": "Either search_content or search_filename must be provided"}), 400
        
        # Validate and determine the search directory
        if search_dir:
            # Remove leading slash if present
            search_dir = search_dir.lstrip('/')
            
            # Validate the path is safe
            if not is_safe_path(search_dir):
                return jsonify({"error": "Invalid search directory"}), 400
            
            search_directory = os.path.join(BASE_DATA_DIR, search_dir)
        else:
            search_directory = BASE_DATA_DIR
        
        # Check if the search directory exists
        if not os.path.exists(search_directory) or not os.path.isdir(search_directory):
            return jsonify({"files": []}), 200
        
        # Perform the search
        matching_files = []
        
        if search_content:
            matching_files.extend(search_files_by_content(search_directory, search_content))
        
        if search_filename:
            matching_files.extend(search_files_by_name(search_directory, search_filename))
        
        # Remove duplicates while preserving order
        unique_files = []
        seen = set()
        for file in matching_files:
            if file not in seen:
                unique_files.append(file)
                seen.add(file)
        
        return jsonify({"files": unique_files}), 200
        
    except Exception as e:
        # Log the error in a real application
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)