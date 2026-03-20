import os
from flask import Flask, request, jsonify

app = Flask(__name__)

DATA_DIR = os.path.realpath("/data")


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def is_safe_path(base, path):
    """Ensure the resolved path is under the base directory."""
    resolved = os.path.realpath(path)
    return resolved.startswith(base + os.sep) or resolved == base


@app.route('/search', methods=['POST'])
def search():
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        search_content = data.get("search_content")
        search_filename = data.get("search_filename")
        search_dir = data.get("search_dir")

        # Validate types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "search_content must be a string or null"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "search_filename must be a string or null"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "search_dir must be a string or null"}), 400

        # At least one search criterion must be provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400

        # Prevent path traversal in search_filename
        if search_filename is not None:
            # filename should not contain path separators
            if os.sep in search_filename or '/' in search_filename or '\\' in search_filename:
                return jsonify({"error": "Invalid filename"}), 400
            if '..' in search_filename:
                return jsonify({"error": "Invalid filename"}), 400

        # Determine the root search directory
        if search_dir:
            # Construct the search path and validate it
            candidate = os.path.join(DATA_DIR, search_dir.lstrip('/'))
            candidate = os.path.realpath(candidate)
            if not is_safe_path(DATA_DIR, candidate):
                return jsonify({"error": "Invalid search directory"}), 400
            root_dir = candidate
        else:
            root_dir = DATA_DIR

        if not os.path.isdir(root_dir):
            return jsonify({"files": []}), 200

        matching_files = []

        for dirpath, dirnames, filenames in os.walk(root_dir):
            # Ensure we're still within DATA_DIR (symlink protection)
            real_dirpath = os.path.realpath(dirpath)
            if not is_safe_path(DATA_DIR, real_dirpath):
                dirnames.clear()
                continue

            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                real_filepath = os.path.realpath(filepath)

                # Ensure file is within DATA_DIR (symlink protection)
                if not is_safe_path(DATA_DIR, real_filepath):
                    continue

                match = False

                # Check filename match
                if search_filename is not None:
                    if filename.startswith(search_filename) or filename == search_filename:
                        match = True

                # Check content match
                if not match and search_content is not None:
                    try:
                        with open(real_filepath, 'r', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except (IOError, OSError, PermissionError):
                        # Skip files that can't be read
                        continue

                if match:
                    matching_files.append(real_filepath)

        return jsonify({"files": matching_files}), 200

    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)