from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

FILES_ROOT = './files'

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Validate regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct the search path
        search_path = os.path.join(FILES_ROOT, directory)
        
        # Normalize the path to prevent directory traversal
        search_path = os.path.normpath(search_path)
        files_root_abs = os.path.abspath(FILES_ROOT)
        search_path_abs = os.path.abspath(search_path)
        
        # Ensure the search path is within FILES_ROOT
        if not search_path_abs.startswith(files_root_abs):
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Check if directory exists
        if not os.path.exists(search_path):
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Search for matching files
        matching_files = []
        
        if recursive:
            # Recursive search
            for root, dirs, files in os.walk(search_path):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    if check_file_matches(file_path, compiled_regex):
                        # Get relative path from search_path
                        rel_path = os.path.relpath(file_path, search_path)
                        matching_files.append(rel_path)
        else:
            # Non-recursive search (only immediate files)
            try:
                items = os.listdir(search_path)
                for item in items:
                    file_path = os.path.join(search_path, item)
                    if os.path.isfile(file_path):
                        if check_file_matches(file_path, compiled_regex):
                            matching_files.append(item)
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


def check_file_matches(file_path, compiled_regex):
    """
    Check if file content matches the given regex pattern.
    Returns True if any part of the file content matches the regex.
    """
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            if compiled_regex.search(content):
                return True
    except Exception:
        # Skip files that can't be read
        pass
    return False


if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)