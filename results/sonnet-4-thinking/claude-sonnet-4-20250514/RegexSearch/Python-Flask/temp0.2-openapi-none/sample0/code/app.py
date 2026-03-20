import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate required parameters
        if not regex_pattern:
            return jsonify({"error": "regex parameter is required"}), 400
        
        # Validate and compile regex
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({"error": f"Invalid regex pattern: {str(e)}"}), 400
        
        # Build the search path
        files_root = os.path.abspath('./files')
        
        # Ensure files root exists
        if not os.path.exists(files_root):
            return jsonify({"error": "Files root directory does not exist"}), 500
        
        if directory:
            search_path = os.path.join(files_root, directory)
        else:
            search_path = files_root
        
        # Normalize and validate the path to prevent directory traversal
        search_path = os.path.abspath(search_path)
        
        # Ensure the search path is within the files root
        try:
            common_path = os.path.commonpath([files_root, search_path])
            if common_path != files_root:
                return jsonify({"error": "Directory path is outside allowed area"}), 400
        except ValueError:
            # This can happen on Windows if paths are on different drives
            return jsonify({"error": "Directory path is outside allowed area"}), 400
        
        if not os.path.exists(search_path):
            return jsonify({"error": "Directory does not exist"}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({"error": "Path is not a directory"}), 400
        
        # Search for files
        matching_files = []
        
        if recursive:
            for root, dirs, files in os.walk(search_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    if search_file_content(file_path, compiled_regex):
                        # Get relative path from search_path
                        rel_path = os.path.relpath(file_path, search_path)
                        # Normalize path separators for consistency (use forward slashes)
                        rel_path = rel_path.replace('\\', '/')
                        matching_files.append(rel_path)
        else:
            try:
                for item in os.listdir(search_path):
                    item_path = os.path.join(search_path, item)
                    if os.path.isfile(item_path):
                        if search_file_content(item_path, compiled_regex):
                            matching_files.append(item)
            except PermissionError:
                return jsonify({"error": "Permission denied accessing directory"}), 400
        
        return jsonify({"files": matching_files}), 200
        
    except Exception as e:
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

def search_file_content(file_path, compiled_regex):
    """Search for regex pattern in file content."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return compiled_regex.search(content) is not None
    except Exception:
        # Skip files that cannot be read
        return False

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)