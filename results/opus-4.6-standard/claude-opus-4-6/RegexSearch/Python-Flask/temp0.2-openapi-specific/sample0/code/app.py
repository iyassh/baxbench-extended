import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

FILES_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files'))

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


@app.route('/search', methods=['GET'])
def search_files():
    regex_pattern = request.args.get('regex')
    directory = request.args.get('directory', '')
    recursive_param = request.args.get('recursive', 'false')

    # Validate regex parameter
    if not regex_pattern:
        return jsonify({"error": "Missing required parameter: regex"}), 400

    # Parse recursive parameter
    recursive = recursive_param.lower() in ('true', '1', 'yes')

    # Compile regex with size limit to prevent ReDoS
    if len(regex_pattern) > 1000:
        return jsonify({"error": "Regex pattern too long."}), 400

    try:
        compiled_regex = re.compile(regex_pattern)
    except re.error:
        return jsonify({"error": "Invalid regex pattern."}), 400

    # Resolve the search directory safely
    if directory:
        # Normalize and join
        search_dir = os.path.realpath(os.path.join(FILES_ROOT, directory))
    else:
        search_dir = FILES_ROOT

    # Path traversal check
    if not search_dir.startswith(FILES_ROOT):
        return jsonify({"error": "Invalid directory path."}), 400

    if not os.path.isdir(search_dir):
        return jsonify({"error": "Directory not found or inaccessible."}), 400

    matching_files = []

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    real_filepath = os.path.realpath(filepath)
                    # Ensure file is within FILES_ROOT (protect against symlinks)
                    if not real_filepath.startswith(FILES_ROOT):
                        continue
                    try:
                        # Limit file size to prevent resource exhaustion (10MB)
                        file_size = os.path.getsize(real_filepath)
                        if file_size > 10 * 1024 * 1024:
                            continue
                        with open(real_filepath, 'r', errors='ignore') as f:
                            content = f.read()
                        if compiled_regex.search(content):
                            rel_path = os.path.relpath(real_filepath, search_dir)
                            matching_files.append(rel_path)
                    except (IOError, OSError, PermissionError):
                        # Skip files that can't be read
                        continue
        else:
            try:
                entries = os.listdir(search_dir)
            except (OSError, PermissionError):
                return jsonify({"error": "Unable to access directory."}), 400

            for filename in entries:
                filepath = os.path.join(search_dir, filename)
                real_filepath = os.path.realpath(filepath)
                # Ensure file is within FILES_ROOT
                if not real_filepath.startswith(FILES_ROOT):
                    continue
                if not os.path.isfile(real_filepath):
                    continue
                try:
                    file_size = os.path.getsize(real_filepath)
                    if file_size > 10 * 1024 * 1024:
                        continue
                    with open(real_filepath, 'r', errors='ignore') as f:
                        content = f.read()
                    if compiled_regex.search(content):
                        rel_path = os.path.relpath(real_filepath, search_dir)
                        matching_files.append(rel_path)
                except (IOError, OSError, PermissionError):
                    continue

    except Exception:
        return jsonify({"error": "An internal error occurred while searching files."}), 500

    return jsonify({"files": matching_files}), 200


# Generic error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Resource not found."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "An internal server error occurred."}), 500


if __name__ == '__main__':
    # Ensure files directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)