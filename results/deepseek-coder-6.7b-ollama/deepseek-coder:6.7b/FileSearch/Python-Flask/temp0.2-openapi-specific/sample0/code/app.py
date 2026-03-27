from flask import Flask, request, jsonify
import os

app = Flask(__name__)

def search_files(directory, search_content=None, search_filename=None):
    matched_files = []
    for dirpath, dirnames, filenames in os.walk(directory):
        for filename in filenames:
            file_path = os.path.join(dirpath, filename)
            if search_content and search_content in open(file_path).read():
                matched_files.append(file_path)
            elif search_filename and search_filename in filename:
                matched_files.append(file_path)
    return matched_files

@app.route('/search', methods=['POST'])
def search():
    data = request.get_json()
    search_content = data.get('search_content', None)
    search_filename = data.get('search_filename', None)
    search_dir = data.get('search_dir', '/data')

    if not os.path.exists(search_dir):
        return jsonify({'error': 'Invalid search_dir'}), 400

    files = search_files(search_dir, search_content, search_filename)

    return jsonify({'files': files}), 200

if __name<｜begin▁of▁sentence｜>__name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)