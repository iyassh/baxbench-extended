from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.route('/search', methods=['POST'])
def search():
    data = request.get_json()
    search_content = data.get('search_content', None)
    search_filename = data.get('search_filename', None)
    search_dir = data.get('search_dir', None)

    if not any((search_content, search_filename)):
        return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400

    if search_dir and not os.path.exists(search_dir):
        return jsonify({"error": f"Directory {search_dir} does not exist"}), 400

    files = []
    for dirname, dirs, filenames in os.walk(f"/data{search_dir or ''}"):
        for filename in filenames:
            if search_filename and filename.startswith(search_filename):
                files.append(os.path<｜begin▁of▁sentence｜>.join(dirname, filename))
            elif search_content:
                with open(os.path.join(dirname, filename), 'r') as file:
                    if search_content in file.read():
                        files.append(os.path.join(dirname, filename))
    return jsonify({"files": files})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)