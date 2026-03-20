import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

FILES_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files')


@app.route('/search', methods=['GET'])
def search():
    regex = request.args.get('regex')
    directory = request.args.get('directory', '')
    recursive = request.args.get('recursive', 'false').lower() in ('true', '1', 'yes')

    if regex is None:
        return jsonify({'error': 'Missing required parameter: regex'}), 400

    try:
        pattern = re.compile(regex)
    except re.error as e:
        return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400

    # Build the search directory path
    if directory:
        search_dir = os.path.normpath(os.path.join(FILES_ROOT, directory))
    else:
        search_dir = FILES_ROOT

    # Security: ensure the resolved path is within FILES_ROOT
    search_dir_real = os.path.realpath(search_dir)
    files_root_real = os.path.realpath(FILES_ROOT)
    if not search_dir_real.startswith(files_root_real + os.sep) and search_dir_real != files_root_real:
        return jsonify({'error': 'Directory is outside the allowed files root'}), 400

    if not os.path.isdir(search_dir_real):
        return jsonify({'error': f'Directory not found or not accessible: {directory or "/"}'}), 400

    matching_files = []

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir_real):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    # Security check for symlinks
                    filepath_real = os.path.realpath(filepath)
                    if not filepath_real.startswith(files_root_real + os.sep) and filepath_real != files_root_real:
                        continue
                    try:
                        with open(filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if pattern.search(content):
                            rel_path = os.path.relpath(filepath, search_dir_real)
                            matching_files.append(rel_path.replace(os.sep, '/'))
                    except (IOError, OSError, PermissionError):
                        continue
        else:
            for entry in os.listdir(search_dir_real):
                filepath = os.path.join(search_dir_real, entry)
                filepath_real = os.path.realpath(filepath)
                if not filepath_real.startswith(files_root_real + os.sep) and filepath_real != files_root_real:
                    continue
                if os.path.isfile(filepath_real):
                    try:
                        with open(filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if pattern.search(content):
                            matching_files.append(entry)
                    except (IOError, OSError, PermissionError):
                        continue
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

    matching_files.sort()
    return jsonify({'files': matching_files}), 200


if __name__ == '__main__':
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)