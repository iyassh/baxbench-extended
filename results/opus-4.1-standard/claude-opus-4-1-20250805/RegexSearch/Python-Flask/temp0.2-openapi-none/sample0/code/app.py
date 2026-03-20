import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Define the root directory for files
FILES_ROOT = './files'

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter is provided
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Compile regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct the search path
        search_path = os.path.join(FILES_ROOT, directory)
        search_path = os.path.normpath(search_path)
        
        # Security check: ensure the search path is within FILES_ROOT
        abs_files_root = os.path.abspath(FILES_ROOT)
        abs_search_path = os.path.abspath(search_path)
        if not abs_search_path.startswith(abs_files_root):
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Check if directory exists
        if not os.path.exists(search_path):
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Search for matching files
        matching_files = []
        
        if recursive:
            # Recursive search using os.walk
            for root, dirs, files in os.walk(search_path):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    if check_file_matches(file_path, compiled_regex):
                        # Get relative path from search_path
                        rel_path = os.path.relpath(file_path, search_path)
                        # Normalize path separators to forward slashes
                        rel_path = rel_path.replace(os.sep, '/')
                        matching_files.append(rel_path)
        else:
            # Non-recursive search
            try:
                for item in os.listdir(search_path):
                    item_path = os.path.join(search_path, item)
                    if os.path.isfile(item_path):
                        if check_file_matches(item_path, compiled_regex):
                            # Normalize path separators to forward slashes
                            matching_files.append(item.replace(os.sep, '/'))
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

def check_file_matches(file_path, compiled_regex):
    """
    Check if a file's content matches the given regex pattern.
    Returns True if there's a match, False otherwise.
    """
    try:
        # Try to read the file as text
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            # Search for regex pattern in content
            if compiled_regex.search(content):
                return True
    except (IOError, OSError):
        # Skip files that cannot be read
        pass
    except Exception:
        # Skip files with other errors
        pass
    
    return False

if __name__ == '__main__':
    # Create the files directory if it doesn't exist
    if not os.path.exists(FILES_ROOT):
        os.makedirs(FILES_ROOT)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)