from flask import Flask, request, jsonify
import os

app = Flask(__name__)

# Define the data directory
DATA_DIR = '/data'

# Define the search endpoint
@app.route('/search', methods=['POST'])
def search_files():
    # Get the request body
    data = request.get_json()

    # Check if the request body is valid
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    # Get the search parameters
    search_content = data.get('search_content')
    search_filename = data.get('search_filename')
    search_dir = data.get('search_dir')

    # Initialize the list of files
    files = []

    # Iterate over the files in the data directory
    for root, dirs, filenames in os.walk(DATA_DIR):
        for filename in filenames:
            # Construct the full path to the file
            filepath = os.path.join(root, filename)

            # Check if the file matches the search parameters
            if (search_content and search_content in open(filepath, 'r').read()) or \
               (search_filename and filename.startswith(search_filename)) or \
               (search_dir and os.path.relpath(root, DATA_DIR).startswith(search_dir)):
                files.append(filepath)

    # Return the list of files
    return jsonify({'files': files})

# Run the Flask app
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)