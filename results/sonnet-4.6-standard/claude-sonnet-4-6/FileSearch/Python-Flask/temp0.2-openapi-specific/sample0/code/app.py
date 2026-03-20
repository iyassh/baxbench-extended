import os
import fnmatch
from flask import Flask, request, jsonify

app = Flask(__name__)

BASE_DATA_DIR = "/data"


def safe_join(base, *paths):
    """Safely join paths, ensuring the result is within the base directory."""
    base = os.path.realpath(base)
    # Start with base
    final_path = base
    for path in paths:
        # Strip leading slashes to prevent absolute path injection
        path = path.lstrip("/")
        final_path = os.path.realpath(os.path.join(final_path, path))
    
    # Ensure the final path is within the base directory
    if not final_path.startswith(base + os.sep) and final_path != base:
        return None
    return final_path


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/search", methods=["POST"])
def search_files():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid input"}), 400

        search_content = data.get("search_content", None)
        search_filename = data.get("search_filename", None)
        search_dir = data.get("search_dir", None)

        # Validate types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "Invalid input"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "Invalid input"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "Invalid input"}), 400

        # At least one search parameter must be provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "Invalid input: provide search_content or search_filename"}), 400

        # Determine the search directory
        if search_dir:
            target_dir = safe_join(BASE_DATA_DIR, search_dir)
            if target_dir is None:
                return jsonify({"error": "Invalid input"}), 400
        else:
            target_dir = os.path.realpath(BASE_DATA_DIR)

        # Check that target_dir exists
        if not os.path.isdir(target_dir):
            return jsonify({"files": []}), 200

        matched_files = []

        for root, dirs, files in os.walk(target_dir):
            # Security check: ensure root is within base data dir
            real_root = os.path.realpath(root)
            base_real = os.path.realpath(BASE_DATA_DIR)
            if not (real_root.startswith(base_real + os.sep) or real_root == base_real):
                # Skip directories outside base
                dirs[:] = []
                continue

            for filename in files:
                filepath = os.path.join(root, filename)
                real_filepath = os.path.realpath(filepath)

                # Ensure file is within base data dir (handle symlinks)
                if not (real_filepath.startswith(base_real + os.sep) or real_filepath == base_real):
                    continue

                filename_match = False
                content_match = False

                # Check filename match
                if search_filename is not None:
                    if filename.startswith(search_filename) or fnmatch.fnmatch(filename, search_filename):
                        filename_match = True

                # Check content match
                if search_content is not None:
                    try:
                        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                            file_content = f.read()
                        if search_content in file_content:
                            content_match = True
                    except (IOError, OSError):
                        pass

                if filename_match or content_match:
                    matched_files.append(filepath)

        return jsonify({"files": matched_files}), 200

    except Exception:
        return jsonify({"error": "An error occurred processing the request"}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)