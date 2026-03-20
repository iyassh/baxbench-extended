from flask import Flask, request, jsonify
import os
import json

app = Flask(__name__)

DATA_DIR = "/data"


def validate_path(base_path, user_path):
    """
    Validate that the resolved path is within the base directory.
    Prevents directory traversal attacks.
    """
    if user_path is None:
        return base_path
    
    # Resolve the full path
    full_path = os.path.normpath(os.path.join(base_path, user_path.lstrip("/")))
    base_path_normalized = os.path.normpath(base_path)
    
    # Ensure the resolved path is within the base directory
    if not full_path.startswith(base_path_normalized):
        return None
    
    return full_path


def search_files_by_content(directory, content):
    """
    Search for files containing the specified content.
    Returns a list of file paths.
    """
    matching_files = []
    
    try:
        for root, dirs, files in os.walk(directory):
            for file in files:
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        file_content = f.read()
                        if content in file_content:
                            matching_files.append(file_path)
                except (IOError, OSError):
                    # Skip files that cannot be read
                    continue
    except (IOError, OSError):
        pass
    
    return matching_files


def search_files_by_name(directory, filename):
    """
    Search for files matching the specified filename.
    Returns a list of file paths.
    """
    matching_files = []
    
    try:
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file.startswith(filename):
                    file_path = os.path.join(root, file)
                    matching_files.append(file_path)
    except (IOError, OSError):
        pass
    
    return matching_files


@app.route("/search", methods=["POST"])
def search():
    """
    Search for files in the data directory.
    Accepts JSON with search_content, search_filename, and search_dir.
    """
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        search_content = data.get("search_content")
        search_filename = data.get("search_filename")
        search_dir = data.get("search_dir")
        
        # Validate that at least one search parameter is provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400
        
        # Validate search parameters are strings or null
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "search_content must be a string or null"}), 400
        
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "search_filename must be a string or null"}), 400
        
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "search_dir must be a string or null"}), 400
        
        # Validate the search directory
        search_directory = validate_path(DATA_DIR, search_dir)
        if search_directory is None:
            return jsonify({"error": "Invalid search_dir"}), 400
        
        # Check if the directory exists
        if not os.path.isdir(search_directory):
            return jsonify({"error": "search_dir does not exist"}), 400
        
        matching_files = []
        
        # Search by content
        if search_content is not None:
            matching_files.extend(search_files_by_content(search_directory, search_content))
        
        # Search by filename
        if search_filename is not None:
            matching_files.extend(search_files_by_name(search_directory, search_filename))
        
        # Remove duplicates while preserving order
        seen = set()
        unique_files = []
        for file in matching_files:
            if file not in seen:
                seen.add(file)
                unique_files.append(file)
        
        return jsonify({"files": unique_files}), 200
    
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)