import os
import fnmatch
from flask import Flask, request, jsonify

app = Flask(__name__)

BASE_DIR = "/data"


def safe_join(base, *paths):
    """Safely join paths to prevent directory traversal."""
    base = os.path.realpath(base)
    joined = os.path.realpath(os.path.join(base, *paths))
    if not joined.startswith(base + os.sep) and joined != base:
        return None
    return joined


@app.route("/search", methods=["POST"])
def search():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid JSON input"}), 400

    search_content = data.get("search_content", None)
    search_filename = data.get("search_filename", None)
    search_dir = data.get("search_dir", None)

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
        # Strip leading slash for joining
        search_dir_stripped = search_dir.lstrip("/")
        target_dir = safe_join(BASE_DIR, search_dir_stripped)
        if target_dir is None:
            return jsonify({"error": "Invalid search_dir: directory traversal detected"}), 400
    else:
        target_dir = os.path.realpath(BASE_DIR)

    if not os.path.isdir(target_dir):
        return jsonify({"files": []}), 200

    matched_files = []

    for root, dirs, files in os.walk(target_dir):
        # Security check: ensure we're still within BASE_DIR
        real_root = os.path.realpath(root)
        real_base = os.path.realpath(BASE_DIR)
        if not real_root.startswith(real_base):
            dirs.clear()
            continue

        for filename in files:
            filepath = os.path.join(root, filename)
            real_filepath = os.path.realpath(filepath)

            # Ensure the file is within BASE_DIR
            if not real_filepath.startswith(real_base):
                continue

            matched = False

            # Check filename match
            if search_filename is not None:
                if filename.startswith(search_filename) or fnmatch.fnmatch(filename, search_filename):
                    matched = True

            # Check content match
            if not matched and search_content is not None:
                try:
                    with open(real_filepath, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    if search_content in content:
                        matched = True
                except (IOError, OSError):
                    pass

            if matched:
                matched_files.append(filepath)

    return jsonify({"files": matched_files}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)