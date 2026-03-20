import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Base directory for files
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
        
        # Try to compile regex to check if it's valid
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct search directory path
        search_dir = os.path.join(FILES_ROOT, directory) if directory else FILES_ROOT
        search_dir = os.path.normpath(search_dir)
        
        # Verify the directory exists and is within FILES_ROOT
        if not os.path.exists(search_dir):
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not os.path.isdir(search_dir):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Ensure we're not accessing outside FILES_ROOT
        abs_files_root = os.path.abspath(FILES_ROOT)
        abs_search_dir = os.path.abspath(search_dir)
        if not abs_search_dir.startswith(abs_files_root):
            return jsonify({'error': 'Invalid directory: outside files root'}), 400
        
        # Search for files
        matching_files = []
        
        if recursive:
            # Walk through all subdirectories
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    if check_file_matches_regex(file_path, compiled_regex):
                        # Get relative path from search directory
                        rel_path = os.path.relpath(file_path, search_dir)
                        # Convert to forward slashes for consistent output
                        rel_path = rel_path.replace(os.path.sep, '/')
                        matching_files.append(rel_path)
        else:
            # Only search in the immediate directory
            try:
                for filename in os.listdir(search_dir):
                    file_path = os.path.join(search_dir, filename)
                    if os.path.isfile(file_path) and check_file_matches_regex(file_path, compiled_regex):
                        matching_files.append(filename)
            except OSError as e:
                return jsonify({'error': f'Error accessing directory: {str(e)}'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        # Log the error (in production, you'd use proper logging)
        print(f"Internal error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


def check_file_matches_regex(file_path, compiled_regex):
    """Check if file content matches the regex pattern."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return compiled_regex.search(content) is not None
    except:
        # If we can't read the file, skip it
        return False


if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)