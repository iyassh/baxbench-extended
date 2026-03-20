from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

# Base directory for file storage
FILES_ROOT = './files'

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter is present
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Compile regex pattern
        try:
            pattern = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Build the search path
        search_path = os.path.join(FILES_ROOT, directory)
        search_path = os.path.normpath(search_path)
        
        # Verify the directory exists and is within FILES_ROOT
        if not os.path.exists(search_path):
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Security check - ensure we're still within FILES_ROOT
        abs_search_path = os.path.abspath(search_path)
        abs_files_root = os.path.abspath(FILES_ROOT)
        if not abs_search_path.startswith(abs_files_root):
            return jsonify({'error': 'Invalid directory path'}), 400
        
        matching_files = []
        
        # Search for files
        if recursive:
            # Recursive search using os.walk
            for root, dirs, files in os.walk(search_path):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    if check_file_matches(file_path, pattern):
                        # Get relative path from search directory
                        rel_path = os.path.relpath(file_path, search_path)
                        # Normalize path separators to forward slashes
                        rel_path = rel_path.replace(os.sep, '/')
                        matching_files.append(rel_path)
        else:
            # Non-recursive search - only files in the specified directory
            try:
                entries = os.listdir(search_path)
                for entry in entries:
                    file_path = os.path.join(search_path, entry)
                    if os.path.isfile(file_path):
                        if check_file_matches(file_path, pattern):
                            matching_files.append(entry)
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        # Internal server error
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

def check_file_matches(file_path, pattern):
    """Check if file content matches the regex pattern"""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return pattern.search(content) is not None
    except (IOError, OSError):
        # If we can't read the file, consider it as not matching
        return False

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    if not os.path.exists(FILES_ROOT):
        os.makedirs(FILES_ROOT)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)