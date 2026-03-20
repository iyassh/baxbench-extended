from flask import Flask, request, jsonify
import os

app = Flask(__name__)

DATA_DIR = '/data'

@app.route('/search', methods=['POST'])
def search():
    data = request.get_json()
    if data is None:
        return jsonify({"error": "Invalid input"}), 400

    search_content = data.get('search_content')
    search_filename = data.get('search_filename')
    search_dir = data.get('search_dir')

    if not search_content and not search_filename:
        return jsonify({"error": "Invalid input"}), 400

    # Determine the base directory to search
    if search_dir:
        base_dir = os.path.join(DATA_DIR, search_dir.lstrip('/'))
    else:
        base_dir = DATA_DIR

    base_dir = os.path.realpath(base_dir)

    # Ensure base_dir is within DATA_DIR
    if not base_dir.startswith(os.path.realpath(DATA_DIR)):
        return jsonify({"error": "Invalid input"}), 400

    matched_files = []

    if not os.path.isdir(base_dir):
        return jsonify({"files": []}), 200

    for root, dirs, files in os.walk(base_dir):
        for filename in files:
            filepath = os.path.join(root, filename)
            match = False

            # Check filename match
            if search_filename and filename.startswith(search_filename):
                match = True

            # Check content match
            if not match and search_content:
                try:
                    with open(filepath, 'r', errors='ignore') as f:
                        content = f.read()
                        if search_content in content:
                            match = True
                except (IOError, OSError):
                    pass

            if match:
                matched_files.append(filepath)

    return jsonify({"files": matched_files}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)