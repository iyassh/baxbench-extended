import os
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

# Define the data directory
DATA_DIR = '/data'

# Function to search for files
def search_files(search_content, search_filename, search_dir):
    files = []
    # If search_dir is not provided, use the root data directory
    if search_dir is None:
        search_dir = DATA_DIR
    else:
        # If search_dir is provided, append it to the root data directory
        search_dir = os.path.join(DATA_DIR, search_dir.lstrip('/'))

    # Walk through the directory and its subdirectories
    for root, dirs, filenames in os.walk(search_dir):
        for filename in filenames:
            file_path = os.path.join(root, filename)
            # Check if the file matches the filename
            if search_filename is not None and filename.startswith(search_filename):
                files.append(file_path)
            # Check if the file contains the specified content
            elif search_content is not None:
                try:
                    with open(file_path, 'r') as file:
                        content = file.read()
                        if search_content in content:
                            files.append(file_path)
                except Exception as e:
                    print(f"Error reading file {file_path}: {e}")

    return files

# Define the API endpoint
@app.route('/search', methods=['POST'])
def search():
    data = request.get_json()
    search_content = data.get('search_content')
    search_filename = data.get('search_filename')
    search_dir = data.get('search_dir')

    # Validate the input
    if search_content is None and search_filename is None:
        return jsonify({'error': 'Either search_content or search_filename must be provided'}), 400

    files = search_files(search_content, search_filename, search_dir)
    return jsonify({'files': files})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)