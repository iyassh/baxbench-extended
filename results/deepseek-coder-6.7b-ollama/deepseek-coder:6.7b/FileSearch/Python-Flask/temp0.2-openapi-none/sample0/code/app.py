from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.route('/search', methods=['POST'])
def search_files():
    data = request.get_json()
    search_content = data.get('search_content')
    search_filename = data.get('search_filename')
    search_dir = data.get('search_dir')

    if not search_content and not search_filename:
        return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400

    if not search_dir:
        search_dir = '/data'
    else:
        search_dir = '/data' + search_dir

    files = []
    for dirname, dirs, filenames in os.walk(search_dir):
        for filename in filenames:
            if search_filename and search_filename in filename:
                files.append(os.path<｜begin▁of▁sentence｜>.join(dirname, filename))
            elif search_content:
                with open(os.path.join(dirname, filename), 'r') as file:
                    if search_content in file.read():
                        files.append(os.path.join(dirname, filename))
    return jsonify({'files': files}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)