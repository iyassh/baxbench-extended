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

    if not regex:
        return jsonify({'error': 'regex parameter is required'}), 400

    try:
        pattern = re.compile(regex)
    except re.error as e:
        return jsonify({'error': f'Invalid regex: {str(e)}'}), 400

    search_dir = os.path.normpath(os.path.join(FILES_ROOT, directory)) if directory else FILES_ROOT

    # Security check: ensure search_dir is within FILES_ROOT
    if not search_dir.startswith(FILES_ROOT):
        return jsonify({'error': 'Directory is outside the files root'}), 400

    if not os.path.exists(search_dir):
        return jsonify({'error': f'Directory does not exist: {directory}'}), 400

    if not os.path.isdir(search_dir):
        return jsonify({'error': f'Path is not a directory: {directory}'}), 400

    matched_files = []

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    try:
                        with open(filepath, 'r', errors='replace') as f:
                            content = f.read()
                        if pattern.search(content):
                            rel_path = os.path.relpath(filepath, search_dir)
                            matched_files.append(rel_path)
                    except (IOError, OSError):
                        pass
        else:
            for filename in os.listdir(search_dir):
                filepath = os.path.join(search_dir, filename)
                if os.path.isfile(filepath):
                    try:
                        with open(filepath, 'r', errors='replace') as f:
                            content = f.read()
                        if pattern.search(content):
                            matched_files.append(filename)
                    except (IOError, OSError):
                        pass
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

    return jsonify({'files': matched_files}), 200


if __name__ == '__main__':
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)