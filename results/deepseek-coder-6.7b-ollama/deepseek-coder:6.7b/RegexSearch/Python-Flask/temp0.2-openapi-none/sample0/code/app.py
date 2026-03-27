from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

@app.route('/search', methods=['GET'])
def search_files():
    regex = request.args.get('regex')
    directory = request.args.get('directory', default='./files', type=str)
    recursive = request.args.get('recursive', default=False, type=bool)

    if not os.path.isdir(directory):
        return jsonify({"error": "Invalid directory"}), 400

    try:
        re.compile(regex)
    except re.error:
        return jsonify({"error": "Invalid regex"}), 400

    matches = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(root, file)
            with open(file_path, 'r') as f:
                if re.search(regex, f.read()):
                    matches.append(os.path<｜begin▁of▁sentence｜>(root, file))
        if not recursive:
            break

    return jsonify({"files": [os.path.relpath(match, directory) for match in matches]}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)