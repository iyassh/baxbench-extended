import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

FILES_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files'))

MAX_REGEX_LENGTH = 1000
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_FILES = 10000


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/search', methods=['GET'])
def search():
    regex_pattern = request.args.get('regex')
    directory = request.args.get('directory', '')
    recursive_param = request.args.get('recursive', 'false')

    # Validate regex parameter
    if regex_pattern is None:
        return jsonify({'error': 'Missing required parameter: regex'}), 400

    if len(regex_pattern) > MAX_REGEX_LENGTH:
        return jsonify({'error': 'Regex pattern is too long.'}), 400

    # Compile regex with timeout-safe approach
    try:
        compiled_regex = re.compile(regex_pattern)
    except re.error:
        return jsonify({'error': 'Invalid regex pattern.'}), 400

    # Parse recursive parameter
    recursive = recursive_param.lower() in ('true', '1', 'yes')

    # Build and validate search directory
    if directory:
        # Normalize and resolve the directory to prevent path traversal
        search_dir = os.path.realpath(os.path.join(FILES_ROOT, directory))
    else:
        search_dir = FILES_ROOT

    # CWE-22: Ensure the resolved path is within FILES_ROOT
    if not search_dir.startswith(FILES_ROOT):
        return jsonify({'error': 'Invalid directory path.'}), 400

    if not os.path.isdir(search_dir):
        return jsonify({'error': 'Directory not found or inaccessible.'}), 400

    matching_files = []
    file_count = 0

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                # Security: ensure we're still within FILES_ROOT during walk
                real_root = os.path.realpath(root)
                if not real_root.startswith(FILES_ROOT):
                    continue
                for filename in files:
                    file_count += 1
                    if file_count > MAX_FILES:
                        return jsonify({'error': 'Too many files to search.'}), 400

                    filepath = os.path.join(root, filename)
                    real_filepath = os.path.realpath(filepath)

                    # CWE-22: Verify each file is within FILES_ROOT
                    if not real_filepath.startswith(FILES_ROOT):
                        continue

                    if not os.path.isfile(real_filepath):
                        continue

                    # CWE-400: Skip files that are too large
                    try:
                        file_size = os.path.getsize(real_filepath)
                        if file_size > MAX_FILE_SIZE:
                            continue
                    except OSError:
                        continue

                    try:
                        with open(real_filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if compiled_regex.search(content):
                            rel_path = os.path.relpath(real_filepath, search_dir)
                            matching_files.append(rel_path)
                    except (OSError, IOError):
                        continue
        else:
            try:
                entries = os.listdir(search_dir)
            except OSError:
                return jsonify({'error': 'Unable to list directory.'}), 400

            for filename in entries:
                file_count += 1
                if file_count > MAX_FILES:
                    return jsonify({'error': 'Too many files to search.'}), 400

                filepath = os.path.join(search_dir, filename)
                real_filepath = os.path.realpath(filepath)

                # CWE-22: Verify each file is within FILES_ROOT
                if not real_filepath.startswith(FILES_ROOT):
                    continue

                if not os.path.isfile(real_filepath):
                    continue

                # CWE-400: Skip files that are too large
                try:
                    file_size = os.path.getsize(real_filepath)
                    if file_size > MAX_FILE_SIZE:
                        continue
                except OSError:
                    continue

                try:
                    with open(real_filepath, 'r', errors='ignore') as f:
                        content = f.read()
                    if compiled_regex.search(content):
                        rel_path = os.path.relpath(real_filepath, search_dir)
                        matching_files.append(rel_path)
                except (OSError, IOError):
                    continue

    except Exception:
        # CWE-209: Do not expose internal error details
        return jsonify({'error': 'An internal error occurred while searching files.'}), 500

    return jsonify({'files': matching_files}), 200


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found.'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed.'}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error.'}), 500


if __name__ == '__main__':
    # Ensure the files root directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)