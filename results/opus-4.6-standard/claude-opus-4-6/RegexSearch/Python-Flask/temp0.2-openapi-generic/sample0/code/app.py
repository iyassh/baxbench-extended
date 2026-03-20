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

    # Resolve the search directory
    if directory:
        search_dir = os.path.realpath(os.path.join(FILES_ROOT, directory))
    else:
        search_dir = os.path.realpath(FILES_ROOT)

    # Security: ensure the resolved path is within FILES_ROOT
    if not search_dir.startswith(os.path.realpath(FILES_ROOT)):
        return jsonify({'error': 'Directory is outside the allowed files root.'}), 400

    if not os.path.isdir(search_dir):
        return jsonify({'error': 'Directory does not exist or is not accessible.'}), 400

    try:
        matching_files = []

        if recursive:
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    real_filepath = os.path.realpath(filepath)
                    # Security check: ensure file is within FILES_ROOT
                    if not real_filepath.startswith(os.path.realpath(FILES_ROOT)):
                        continue
                    try:
                        with open(filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if pattern.search(content):
                            rel_path = os.path.relpath(filepath, search_dir)
                            matching_files.append(rel_path.replace(os.sep, '/'))
                    except (IOError, OSError):
                        continue
        else:
            try:
                entries = os.listdir(search_dir)
            except OSError:
                return jsonify({'error': 'Unable to list directory.'}), 400

            for entry in entries:
                filepath = os.path.join(search_dir, entry)
                real_filepath = os.path.realpath(filepath)
                if not real_filepath.startswith(os.path.realpath(FILES_ROOT)):
                    continue
                if os.path.isfile(filepath):
                    try:
                        with open(filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if pattern.search(content):
                            matching_files.append(entry)
                    except (IOError, OSError):
                        continue

        matching_files.sort()
        return jsonify({'files': matching_files}), 200

    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


if __name__ == '__main__':
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)