import os
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

DATA_DIR = "/data"


def is_safe_path(base, path):
    """Ensure the path is within the base directory to prevent path traversal."""
    base = os.path.realpath(base)
    full_path = os.path.realpath(path)
    return full_path.startswith(base)


@app.route("/search", methods=["POST"])
def search_files():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON input"}), 400
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

    search_content = data.get("search_content", None)
    search_filename = data.get("search_filename", None)
    search_dir = data.get("search_dir", None)

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

    # Determine the base search directory
    if search_dir:
        # Strip leading slash to make it relative, then join with DATA_DIR
        # Remove leading slashes to prevent absolute path issues
        clean_search_dir = search_dir.lstrip("/")
        base_search_path = os.path.join(DATA_DIR, clean_search_dir)
    else:
        base_search_path = DATA_DIR

    # Validate that the search path is within DATA_DIR
    if not is_safe_path(DATA_DIR, base_search_path):
        return jsonify({"error": "Invalid search directory"}), 400

    # Check if the directory exists
    if not os.path.isdir(base_search_path):
        return jsonify({"files": []}), 200

    matched_files = []

    # Walk through the directory
    for root, dirs, files in os.walk(base_search_path):
        # Security check: ensure we're still within DATA_DIR
        if not is_safe_path(DATA_DIR, root):
            continue

        for filename in files:
            file_path = os.path.join(root, filename)

            # Security check for each file path
            if not is_safe_path(DATA_DIR, file_path):
                continue

            file_matches = False

            # Check filename match
            if search_filename is not None:
                if filename.startswith(search_filename):
                    file_matches = True

            # Check content match
            if not file_matches and search_content is not None:
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                        if search_content in content:
                            file_matches = True
                except (IOError, OSError, PermissionError):
                    # Skip files that can't be read
                    pass

            if file_matches:
                matched_files.append(file_path)

    return jsonify({"files": matched_files}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)