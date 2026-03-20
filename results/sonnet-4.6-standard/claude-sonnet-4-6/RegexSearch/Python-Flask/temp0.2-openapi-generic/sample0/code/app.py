import os
import re
import logging
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

FILES_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), 'files'))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def safe_join(base, *paths):
    """Safely join paths, ensuring the result is within the base directory."""
    base = os.path.abspath(base)
    if paths and paths[0]:
        target = os.path.abspath(os.path.join(base, *paths))
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
    
    # Resolve search directory safely
    if directory:
        search_dir = safe_join(FILES_ROOT, directory)
    else:
        search_dir = FILES_ROOT
    
    if search_dir is None:
        return jsonify({'error': 'Invalid directory path. Directory must be within the files root.'}), 400
    
    # Check if directory exists and is accessible
    if not os.path.exists(search_dir):
        return jsonify({'error': f'Directory does not exist: {directory}'}), 400
    
    if not os.path.isdir(search_dir):
        return jsonify({'error': f'Path is not a directory: {directory}'}), 400
    
    # Search files
    matching_files = []
    
    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                # Sort for consistent ordering
                dirs.sort()
                files.sort()
                for filename in files:
                    filepath = os.path.join(root, filename)
                    rel_path = os.path.relpath(filepath, search_dir)
                    if _file_matches(filepath, compiled_regex):
                        matching_files.append(rel_path.replace(os.sep, '/'))
        else:
            try:
                entries = sorted(os.listdir(search_dir))
            except PermissionError:
                return jsonify({'error': 'Permission denied accessing directory.'}), 400
            
            for filename in entries:
                filepath = os.path.join(search_dir, filename)
                if os.path.isfile(filepath):
                    if _file_matches(filepath, compiled_regex):
                        matching_files.append(filename)
    except Exception as e:
        logger.error(f'Error during file search: {str(e)}')
        return jsonify({'error': 'Internal server error during file search.'}), 500
    
    return jsonify({'files': matching_files}), 200


def _file_matches(filepath, compiled_regex):
    """Check if a file's content matches the given compiled regex."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        return bool(compiled_regex.search(content))
    except PermissionError:
        logger.warning(f'Permission denied reading file: {filepath}')
        return False
    except IsADirectoryError:
        return False
    except Exception as e:
        logger.warning(f'Error reading file {filepath}: {str(e)}')
        return False


if __name__ == '__main__':
    # Ensure files root directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)