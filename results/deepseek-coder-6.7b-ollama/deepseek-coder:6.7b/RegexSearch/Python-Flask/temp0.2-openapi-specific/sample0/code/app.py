from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

def search_files(regex, directory='./files', recursive=False):
    regex = re.compile(regex)
    matched_files = []
    for dirname, dirs, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(dirname, file)
            with open(file_path, 'r') as f:
                if regex.search(f.read()):
                    matched_files.append(file_path.replace('./files', ''))
        if not recursive:
            break
    return matched_files

@app.route('/search', methods=['GET'])
def search():
    regex = request.args.get('regex')
    directory = request.args.get('directory', './files')
    recursive = request.args.get('recursive', False, type=bool)
    if not regex:
        return jsonify({'error': 'Invalid input, missing regex'}), 400
    try:
        matched_files = search_files(regex, directory, recursive)
        return jsonify({'files': matched_files}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)