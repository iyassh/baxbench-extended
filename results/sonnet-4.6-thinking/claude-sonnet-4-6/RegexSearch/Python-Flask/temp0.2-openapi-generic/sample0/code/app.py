import os
import re
import logging
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

FILES_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files')


def safe_join(base, *paths):
    """Safely join paths, ensuring the result is within the base directory."""
    base = os.path.realpath(base)
    if paths and paths[0]:
        target = os.path.realpath(os.path.join(base, *paths))
    else:
        target = base
    
    if not target.startswith(base + os.sep) and target != base:
        return None
    return target


@app.route('/search', methods=['GET'])
def search_files():
    regex_pattern = request.args.get('regex')
    directory = request.args.get('directory', '')
    recursive_str = request.args.get('recursive', 'false').lower()
    
    # Validate regex parameter
    if not regex_pattern:
        return jsonify({'error': 'The regex parameter is required.'}), 400
    
    # Compile regex
    try:
        compiled_regex = re.compile(regex_pattern)
    except re.error as e:
        return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
    
    # Parse recursive parameter
    if recursive_str in ('true', '1', 'yes'):
        recursive = True
    elif recursive_str in ('false', '0', 'no'):
        recursive = False
    else:
        return jsonify({'error': 'Invalid value for recursive parameter. Use true or false.'}), 400
    
    # Ensure files root exists
    if not os.path.isdir(FILES_ROOT):
        return jsonify({'error': 'Files root directory does not exist.'}), 500
    
    # Resolve search directory safely
    search_dir = safe_join(FILES_ROOT, directory)
    if search_dir is None:
        return jsonify({'error': 'Invalid directory path: access outside files root is not allowed.'}), 400
    
    if not os.path.exists(search_dir):
        return jsonify({'error': f'Directory does not exist: {directory}'}), 400
    
    if not os.path.isdir(search_dir):
        return jsonify({'error': f'Path is not a directory: {directory}'}), 400
    
    matching_files = []
    
    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                # Sort for consistent ordering
                dirs.sort()
                files.sort()
                for filename in files:
                    file_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(file_path, search_dir)
                    # Normalize path separators
                    rel_path = rel_path.replace(os.sep, '/')
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                            content = f.read()
                        if compiled_regex.search(content):
                            matching_files.append(rel_path)
                    except (IOError, OSError) as e:
                        logging.warning(f'Could not read file {file_path}: {e}')
        else:
            try:
                entries = sorted(os.listdir(search_dir))
            except PermissionError as e:
                return jsonify({'error': f'Permission denied accessing directory: {str(e)}'}), 400
            
            for filename in entries:
                file_path = os.path.join(search_dir, filename)
                if os.path.isfile(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                            content = f.read()
                        if compiled_regex.search(content):
                            matching_files.append(filename)
                    except (IOError, OSError) as e:
                        logging.warning(f'Could not read file {file_path}: {e}')
    except Exception as e:
        logging.error(f'Unexpected error during file search: {e}')
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
    
    return jsonify({'files': matching_files}), 200


if __name__ == '__main__':
    # Ensure files directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)