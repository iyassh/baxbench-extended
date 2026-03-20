import os
import fnmatch
from flask import Flask, request, jsonify, abort

app = Flask(__name__)

BASE_DATA_DIR = "/data"


def safe_join(base, *paths):
    """Safely join paths, ensuring the result is within the base directory."""
    base = os.path.realpath(base)
    # Join and resolve the path
    joined = os.path.realpath(os.path.join(base, *paths))
    # Ensure the resolved path starts with the base directory
    if not joined.startswith(base + os.sep) and joined != base:
        return None
    return joined


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/search', methods=['POST'])
def search_files():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON input"}), 400

        search_content = data.get('search_content', None)
        search_filename = data.get('search_filename', None)
        search_dir = data.get('search_dir', None)

        # Validate that at least one search parameter is provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400

        # Validate types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "search_content must be a string"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "search_filename must be a string"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "search_dir must be a string"}), 400

        # Determine the search directory
        if search_dir:
            # Strip leading slash to make it relative for safe_join
            search_dir_stripped = search_dir.lstrip('/')
            resolved_dir = safe_join(BASE_DATA_DIR, search_dir_stripped)
            if resolved_dir is None:
                return jsonify({"error": "Invalid search directory"}), 400
        else:
            resolved_dir = os.path.realpath(BASE_DATA_DIR)

        # Check if the directory exists
        if not os.path.isdir(resolved_dir):
            return jsonify({"files": []}), 200

        matched_files = []

        # Walk through the directory
        for root, dirs, files in os.walk(resolved_dir):
            # Security check: ensure we're still within the base data directory
            real_root = os.path.realpath(root)
            base_real = os.path.realpath(BASE_DATA_DIR)
            if not real_root.startswith(base_real + os.sep) and real_root != base_real:
                continue

            for filename in files:
                file_path = os.path.join(root, filename)
                real_file_path = os.path.realpath(file_path)

                # Security check: ensure file is within base data directory
                if not real_file_path.startswith(base_real + os.sep) and real_file_path != base_real:
                    continue

                filename_match = False
                content_match = False

                # Check filename match
                if search_filename is not None:
                    if filename.startswith(search_filename):
                        filename_match = True

                # Check content match
                if search_content is not None:
                    try:
                        with open(real_file_path, 'r', encoding='utf-8', errors='replace') as f:
                            file_content = f.read()
                            if search_content in file_content:
                                content_match = True
                    except (IOError, OSError):
                        # Skip files that can't be read
                        pass

                if filename_match or content_match:
                    matched_files.append(real_file_path)

        return jsonify({"files": matched_files}), 200

    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)