import os
from flask import Flask, request, jsonify

app = Flask(__name__)

def search_files(directory, filename=None, content=None):
    matches = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            if filename and filename not in file:
                continue
            with open(os.path.join(root, file), 'r') as f:
                if content and content not in f.read():
                    continue
            matches.append(os.path.join(root, file))
    return matches

@app.route('/search', methods=['POST'])
def search():
    data = request.get_json()
    search_content = data.get('search_content')
    search_filename = data.get('search_filename')
    search_dir = data.get('search_dir')

    if not search_dir:
        search_dir = '/data'

    files = search_files(search_dir, search_filename, search_content)
    return jsonify({'files': files})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)