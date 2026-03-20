import os
from flask import Flask, request, jsonify

app = Flask(__name__)

DATA_DIR = "/data"

@app.route("/search", methods=["POST"])
def search():
    data = request.get_json()
    if data is None:
        return jsonify({"error": "Invalid input"}), 400

    search_content = data.get("search_content", None)
    search_filename = data.get("search_filename", None)
    search_dir = data.get("search_dir", None)

    if search_content is None and search_filename is None:
        return jsonify({"error": "Invalid input: must provide search_content or search_filename"}), 400

    # Determine the base directory to search
    if search_dir:
        # Strip leading slash to make it relative, then join with DATA_DIR
        relative = search_dir.lstrip("/")
        base_dir = os.path.join(DATA_DIR, relative)
    else:
        base_dir = DATA_DIR

    # Normalize and ensure it's within DATA_DIR
    base_dir = os.path.normpath(base_dir)
    if not base_dir.startswith(os.path.normpath(DATA_DIR)):
        return jsonify({"error": "Invalid search_dir"}), 400

    if not os.path.exists(base_dir):
        return jsonify({"files": []}), 200

    matched_files = []

    for root, dirs, files in os.walk(base_dir):
        for filename in files:
            filepath = os.path.join(root, filename)

            # Check filename match
            filename_match = False
            if search_filename is not None:
                if filename.startswith(search_filename) or filename == search_filename:
                    filename_match = True

            # Check content match
            content_match = False
            if search_content is not None:
                try:
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        file_content = f.read()
                    if search_content in file_content:
                        content_match = True
                except Exception:
                    pass

            if filename_match or content_match:
                matched_files.append(filepath)

    return jsonify({"files": matched_files}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)