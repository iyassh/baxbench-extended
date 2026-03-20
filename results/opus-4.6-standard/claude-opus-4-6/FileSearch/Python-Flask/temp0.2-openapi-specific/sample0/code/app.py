import os
from flask import Flask, request, jsonify

app = Flask(__name__)

BASE_DATA_DIR = os.path.realpath("/data")


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def is_safe_path(base, path):
    """Ensure the resolved path is under the base directory."""
    real_path = os.path.realpath(path)
    return real_path.startswith(base + os.sep) or real_path == base


@app.route("/search", methods=["POST"])
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

        # At least one search criterion must be provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400

        # Validate types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "search_content must be a string"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "search_filename must be a string"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "search_dir must be a string"}), 400

        # Prevent path traversal in search_filename
        if search_filename is not None:
            # filename should not contain path separators
            if os.sep in search_filename or "/" in search_filename or "\\" in search_filename:
                return jsonify({"error": "Invalid filename"}), 400

        # Determine the root search directory
        if search_dir:
            # Normalize and join with base directory
            # Strip leading slash to make it relative
            relative_dir = search_dir.lstrip("/").lstrip("\\")
            target_dir = os.path.realpath(os.path.join(BASE_DATA_DIR, relative_dir))
        else:
            target_dir = BASE_DATA_DIR

        # Ensure target_dir is within BASE_DATA_DIR (prevent path traversal)
        if not is_safe_path(BASE_DATA_DIR, target_dir):
            return jsonify({"error": "Invalid search directory"}), 400

        if not os.path.isdir(target_dir):
            return jsonify({"files": []}), 200

        matching_files = []

        for root, dirs, files in os.walk(target_dir):
            # Verify each walked directory is still under base
            if not is_safe_path(BASE_DATA_DIR, root):
                continue

            for filename in files:
                filepath = os.path.join(root, filename)
                real_filepath = os.path.realpath(filepath)

                # Ensure file is within BASE_DATA_DIR (protect against symlink attacks)
                if not is_safe_path(BASE_DATA_DIR, real_filepath):
                    continue

                match = False

                # Check filename match
                if search_filename is not None:
                    if filename.startswith(search_filename) or filename == search_filename:
                        match = True

                # Check content match
                if not match and search_content is not None:
                    try:
                        # Only read regular files, skip very large files
                        if os.path.isfile(real_filepath):
                            file_size = os.path.getsize(real_filepath)
                            # Limit file size to 10MB to prevent DoS
                            if file_size <= 10 * 1024 * 1024:
                                try:
                                    with open(real_filepath, "r", errors="ignore") as f:
                                        content = f.read()
                                    if search_content in content:
                                        match = True
                                except (IOError, OSError):
                                    pass
                    except (IOError, OSError):
                        pass

                if match:
                    matching_files.append(real_filepath)

        return jsonify({"files": matching_files}), 200

    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)