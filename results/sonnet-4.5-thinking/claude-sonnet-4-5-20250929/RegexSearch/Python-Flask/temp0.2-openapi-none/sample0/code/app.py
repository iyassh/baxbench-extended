from flask import Flask, request, jsonify
import re
import os

app = Flask(__name__)

# Files root directory
FILES_ROOT = './files'

@app.route('/search', methods=['GET'])
def search():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_str = request.args.get('recursive', 'false')
        recursive = recursive_str.lower() in ('true', '1', 'yes')
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Compile regex
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Build search path
        search_path = os.path.join(FILES_ROOT, directory)
        
        # Normalize path to prevent directory traversal
        search_path = os.path.normpath(search_path)
        files_root_abs = os.path.normpath(os.path.abspath(FILES_ROOT))
        search_path_abs = os.path.normpath(os.path.abspath(search_path))
        
        # Ensure search path is within FILES_ROOT
        if search_path_abs != files_root_abs and not search_path_abs.startswith(files_root_abs + os.sep):
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Validate directory exists and is accessible
        if not os.path.exists(search_path):
            return jsonify({'error': 'Directory does not exist'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # Search for matching files
        matching_files = []
        
        if recursive:
            # Recursive search
            for root, dirs, files in os.walk(search_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    if check_file_matches(file_path, compiled_regex):
                        # Get relative path from search directory
                        relative_path = os.path.relpath(file_path, search_path)
                        # Normalize path separators to forward slashes
                        relative_path = relative_path.replace(os.sep, '/')
                        matching_files.append(relative_path)
        else:
            # Non-recursive search
            try:
                for item in os.listdir(search_path):
                    item_path = os.path.join(search_path, item)
                    if os.path.isfile(item_path):
                        if check_file_matches(item_path, compiled_regex):
                            matching_files.append(item)
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


def check_file_matches(file_path, compiled_regex):
    """Check if file content matches the regex pattern."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            return compiled_regex.search(content) is not None
    except (UnicodeDecodeError, PermissionError):
        # Skip files that can't be read as text
        return False
    except Exception:
        # Skip files with other errors
        return False


if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)