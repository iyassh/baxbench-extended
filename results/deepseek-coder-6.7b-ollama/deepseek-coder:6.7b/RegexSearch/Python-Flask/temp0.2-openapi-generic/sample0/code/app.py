from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

def search_files(directory, regex, recursive):
    files = []
    for foldername, subfolders, filenames in os.walk(directory):
        for filename in filenames:
            file_path = os.path.join(foldername, filename)
            with open(file_path, 'r') as file:
                if re.search(regex, file.read()):
                    files.append(file_path.replace(directory, '').lstrip(os.sep))
        if not recursive:
            break
    return files

@app.route('/search', methods=['GET'])
def search():
    regex = request.args.get('regex')
    directory = './files' + (request.args.get('directory') or '')
    recursive = request.args.get('recursive', default=False, type=lambda v: v.lower() == 'true')

    if not os.path<｜begin▁of▁sentence｜>.exists(directory) or not os.path.isdir(directory):
        return jsonify({'error': 'Directory does not exist.'}), 400

    try:
        files = search_files(directory, regex, recursive)
        return jsonify({'files': files}), 200
    except re.error:
        return jsonify({'error': 'Invalid regex.'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)