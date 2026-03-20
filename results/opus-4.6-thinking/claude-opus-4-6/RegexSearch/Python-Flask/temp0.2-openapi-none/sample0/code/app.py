from flask import Flask, request, jsonify
import os
import re

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

    # Security check: ensure search_dir is within FILES_ROOT
    if not os.path.abspath(search_dir).startswith(os.path.abspath(FILES_ROOT)):
        return jsonify({'error': 'Directory is outside the allowed files root.'}), 400

    if not os.path.isdir(search_dir):
        return jsonify({'error': f'Directory not found or inaccessible: {directory or "/"}'}), 400

    matching_files = []

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    rel_path = os.path.relpath(filepath, search_dir)
                    try:
                        with open(filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if pattern.search(content):
                            matching_files.append(rel_path)
                    except (IOError, OSError):
                        continue
        else:
            for entry in os.listdir(search_dir):
                filepath = os.path.join(search_dir, entry)
                if os.path.isfile(filepath):
                    try:
                        with open(filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if pattern.search(content):
                            matching_files.append(entry)
                    except (IOError, OSError):
                        continue
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

    return jsonify({'files': matching_files}), 200


if __name__ == '__main__':
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)