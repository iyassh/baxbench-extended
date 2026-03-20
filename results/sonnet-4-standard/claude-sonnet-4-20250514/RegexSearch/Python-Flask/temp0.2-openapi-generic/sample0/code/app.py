import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Define the files root directory
FILES_ROOT = './files'

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get parameters from query string
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate required parameters
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Validate and compile regex
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct the search path
        search_path = os.path.join(FILES_ROOT, directory) if directory else FILES_ROOT
        
        # Normalize the path to prevent directory traversal attacks
        search_path = os.path.normpath(search_path)
        
        # Ensure the search path is within the files root directory
        if not search_path.startswith(os.path.normpath(FILES_ROOT)):
            return jsonify({'error': 'Directory path is not allowed'}), 400
        
        # Check if the directory exists
        if not os.path.exists(search_path):
            return jsonify({'error': 'Directory does not exist'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        matching_files = []
        
        # Search for files
        if recursive:
            # Recursive search
            for root, dirs, files in os.walk(search_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    if search_file_content(file_path, compiled_regex):
                        # Get relative path from the search directory
                        rel_path = os.path.relpath(file_path, search_path)
                        matching_files.append(rel_path)
        else:
            # Non-recursive search (only current directory)
            try:
                for item in os.listdir(search_path):
                    item_path = os.path.join(search_path, item)
                    if os.path.isfile(item_path):
                        if search_file_content(item_path, compiled_regex):
                            matching_files.append(item)
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

def search_file_content(file_path, compiled_regex):
    """
    Search for regex pattern in file content.
    Returns True if pattern is found, False otherwise.
    """
    try:
        # Try to read file as text with different encodings
        encodings = ['utf-8', 'latin-1', 'cp1252']
        
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    content = f.read()
                    if compiled_regex.search(content):
                        return True
                break
            except UnicodeDecodeError:
                continue
            except PermissionError:
                # Skip files we can't read
                return False
        
        return False
        
    except Exception:
        # Skip files that can't be read for any reason
        return False

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    # Start the Flask application
    app.run(host='0.0.0.0', port=5000, debug=False)