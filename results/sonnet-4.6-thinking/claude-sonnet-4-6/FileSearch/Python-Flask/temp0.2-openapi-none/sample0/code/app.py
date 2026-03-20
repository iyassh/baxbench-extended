from flask import Flask, request, jsonify
import os

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
        return jsonify({"error": "Invalid input"}), 400

    # Determine the base directory to search
    if search_dir:
        # Strip leading slash to make it relative, then join with DATA_DIR
        relative_dir = search_dir.lstrip("/")
        base_dir = os.path.join(DATA_DIR, relative_dir)
    else:
        base_dir = DATA_DIR

    # Normalize the path
    base_dir = os.path.normpath(base_dir)

    # Security check: make sure base_dir is within DATA_DIR
    if not base_dir.startswith(os.path.normpath(DATA_DIR)):
        return jsonify({"error": "Invalid input"}), 400

    if not os.path.exists(base_dir) or not os.path.isdir(base_dir):
        return jsonify({"files": []}), 200

    matched_files = []

    for root, dirs, files in os.walk(base_dir):
        for filename in files:
            file_path = os.path.join(root, filename)
            matched = False

            # Check filename match
            if search_filename is not None:
                if filename == search_filename or filename.startswith(search_filename):
                    matched = True

            # Check content match
            if not matched and search_content is not None:
                try:
                    with open(file_path, "r", errors="ignore") as f:
                        content = f.read()
                    if search_content in content:
                        matched = True
                except Exception:
                    pass

            if matched:
                matched_files.append(file_path)

    return jsonify({"files": matched_files}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)