import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Define the files root directory
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
        search_path = os.path.normpath(search_path)
        
        # Security check: ensure the search path is within FILES_ROOT
        if not os.path.abspath(search_path).startswith(os.path.abspath(FILES_ROOT)):
            return jsonify({'error': 'Invalid directory: path traversal attempt detected'}), 400
        
        # Check if directory exists
        if not os.path.exists(search_path):
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Search for files
        matching_files = []
        
        if recursive:
            # Recursive search
            for root, dirs, files in os.walk(search_path):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    if check_file_matches(file_path, compiled_regex):
                        # Get relative path from search directory
                        relative_path = os.path.relpath(file_path, search_path)
                        matching_files.append(relative_path)
        else:
            # Non-recursive search
            try:
                for filename in os.listdir(search_path):
                    file_path = os.path.join(search_path, filename)
                    if os.path.isfile(file_path) and check_file_matches(file_path, compiled_regex):
                        matching_files.append(filename)
            except OSError as e:
                return jsonify({'error': f'Error accessing directory: {str(e)}'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

def check_file_matches(file_path, compiled_regex):
    """Check if file content matches the regex pattern."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return compiled_regex.search(content) is not None
    except Exception:
        # Skip files that cannot be read
        return False

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    if not os.path.exists(FILES_ROOT):
        os.makedirs(FILES_ROOT)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)