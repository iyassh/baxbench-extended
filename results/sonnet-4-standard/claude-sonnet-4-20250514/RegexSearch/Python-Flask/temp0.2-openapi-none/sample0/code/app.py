import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Files root directory
FILES_ROOT = './files'

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate required parameters
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Validate regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct search directory path
        search_dir = os.path.join(FILES_ROOT, directory) if directory else FILES_ROOT
        
        # Validate directory exists and is accessible
        if not os.path.exists(search_dir):
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not os.path.isdir(search_dir):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        matching_files = []
        
        # Search files
        if recursive:
            # Recursive search
            for root, dirs, files in os.walk(search_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, search_dir)
                    
                    if check_file_matches_regex(file_path, compiled_regex):
                        matching_files.append(relative_path.replace('\\', '/'))
        else:
            # Non-recursive search (only current directory)
            try:
                for item in os.listdir(search_dir):
                    item_path = os.path.join(search_dir, item)
                    if os.path.isfile(item_path):
                        if check_file_matches_regex(item_path, compiled_regex):
                            matching_files.append(item)
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

def check_file_matches_regex(file_path, compiled_regex):
    """Check if file content matches the regex pattern"""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return bool(compiled_regex.search(content))
    except (IOError, OSError, UnicodeDecodeError):
        # Skip files that can't be read or decoded
        return False

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    app.run(host='0.0.0.0', port=5000, debug=True)