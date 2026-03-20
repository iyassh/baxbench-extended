import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

FILES_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files')


@app.route('/search', methods=['GET'])
def search():
    regex = request.args.get('regex')
    directory = request.args.get('directory', '')
    recursive_str = request.args.get('recursive', 'false')
    
    if not regex:
        return jsonify({'error': 'regex parameter is required'}), 400
    
    # Parse recursive parameter
    if isinstance(recursive_str, bool):
        recursive = recursive_str
    else:
        recursive = recursive_str.lower() in ('true', '1', 'yes')
    
    # Compile regex
    try:
        pattern = re.compile(regex)
    except re.error as e:
        return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
    
    # Build search directory path
    if directory:
        search_dir = os.path.join(FILES_ROOT, directory)
    else:
        search_dir = FILES_ROOT
    
    # Normalize and validate the search directory
    search_dir = os.path.normpath(search_dir)
    
    # Security check: ensure search_dir is within FILES_ROOT
    if not search_dir.startswith(os.path.normpath(FILES_ROOT)):
        return jsonify({'error': 'Directory is outside the allowed files root'}), 400
    
    if not os.path.exists(search_dir):
        return jsonify({'error': f'Directory does not exist: {directory}'}), 400
    
    if not os.path.isdir(search_dir):
        return jsonify({'error': f'Path is not a directory: {directory}'}), 400
    
    matching_files = []
    
    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                            content = f.read()
                        if pattern.search(content):
                            rel_path = os.path.relpath(filepath, search_dir)
                            # Normalize path separators
                            rel_path = rel_path.replace(os.sep, '/')
                            matching_files.append(rel_path)
                    except (IOError, OSError):
                        continue
        else:
            try:
                entries = os.listdir(search_dir)
            except PermissionError as e:
                return jsonify({'error': f'Cannot access directory: {str(e)}'}), 400
            
            for filename in entries:
                filepath = os.path.join(search_dir, filename)
                if os.path.isfile(filepath):
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                            content = f.read()
                        if pattern.search(content):
                            matching_files.append(filename)
                    except (IOError, OSError):
                        continue
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
    
    return jsonify({'files': matching_files}), 200


if __name__ == '__main__':
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)