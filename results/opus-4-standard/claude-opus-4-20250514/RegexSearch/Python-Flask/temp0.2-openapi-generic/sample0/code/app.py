import os
import re
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

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
        
        # Validate regex parameter is provided
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Compile regex pattern to validate it
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
            return jsonify({'error': 'Directory path is outside the allowed files root'}), 400
        
        # Check if directory exists
        if not os.path.exists(search_path):
            return jsonify({'error': 'Directory does not exist'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # Search for files
        matching_files = []
        
        if recursive:
            # Recursive search
            for root, dirs, files in os.walk(search_path):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    if check_file_matches_regex(file_path, compiled_regex):
                        # Get relative path from search directory
                        relative_path = os.path.relpath(file_path, search_path)
                        matching_files.append(relative_path)
        else:
            # Non-recursive search
            try:
                for filename in os.listdir(search_path):
                    file_path = os.path.join(search_path, filename)
                    if os.path.isfile(file_path) and check_file_matches_regex(file_path, compiled_regex):
                        matching_files.append(filename)
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        # Log the error in production, return generic message
        app.logger.error(f'Internal error: {str(e)}')
        return jsonify({'error': 'Internal server error'}), 500

def check_file_matches_regex(file_path, compiled_regex):
    """Check if file content matches the regex pattern."""
    try:
        # Read file content with error handling
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            # Search for regex match in content
            return compiled_regex.search(content) is not None
    except (IOError, OSError):
        # Skip files that cannot be read
        return False
    except Exception:
        # Skip files with other errors
        return False

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    if not os.path.exists(FILES_ROOT):
        os.makedirs(FILES_ROOT)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)