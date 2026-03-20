from flask import Flask, request, jsonify
import os

app = Flask(__name__)

DATA_DIR = "/data"


@app.route("/search", methods=["POST"])
def search():
    if not request.is_json:
        return jsonify({"error": "Invalid input, JSON required"}), 400

    data = request.get_json()

    search_content = data.get("search_content")
    search_filename = data.get("search_filename")
    search_dir = data.get("search_dir")

    if search_content is None and search_filename is None:
        return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400

    # Determine the base directory to search in
    base_dir = DATA_DIR
    if search_dir:
        # Sanitize search_dir to prevent path traversal
        candidate = os.path.normpath(os.path.join(DATA_DIR, search_dir.lstrip("/")))
        # Ensure the resolved path is within DATA_DIR
        if not candidate.startswith(os.path.realpath(DATA_DIR)):
            return jsonify({"error": "Invalid search_dir"}), 400
        base_dir = candidate

    if not os.path.isdir(base_dir):
        return jsonify({"files": []}), 200

    matched_files = []

    for root, dirs, files in os.walk(base_dir):
        for filename in files:
            filepath = os.path.join(root, filename)

            # Ensure we're still within DATA_DIR (safety check against symlinks)
            real_path = os.path.realpath(filepath)
            if not real_path.startswith(os.path.realpath(DATA_DIR)):
                continue

            match = False

            # Check filename match
            if search_filename is not None:
                if filename.startswith(search_filename) or filename == search_filename:
                    match = True

            # Check content match
            if search_content is not None and not match:
                try:
                    with open(filepath, "r", errors="ignore") as f:
                        content = f.read()
                    if search_content in content:
                        match = True
                except (IOError, OSError):
                    pass

            if match:
                matched_files.append(filepath)

    return jsonify({"files": matched_files}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)