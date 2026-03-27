from flask import Flask, request, jsonify
import os

app = Flask(__name__)

# Define the data directory
DATA_DIR = '/data'

# Define a function to search for files
def search_files(search_content, search_filename, search_dir):
    """
    Search for files in the data directory that contain the specified content or match the filename.

    Args:
        search_content (str): The content to search for in the files.
        search_filename (str): The filename to search for.
        search_dir (str): The relative path to search in.

    Returns:
        list: A list of complete paths to files that contain the specified content or match the filename.
    """
    # Initialize an empty list to store the results
    results = []

    # Construct the absolute path to the search directory
    search_path = os.path.join(DATA_DIR, search_dir.lstrip('/'))

    # Check if the search directory exists
    if not os.path.exists(search_path):
        return results

    # Iterate over all files in the search directory and its subdirectories
    for root, dirs, files in os.walk(search_path):
        for file in files:
            # Construct the absolute path to the file
            file_path = os.path.join(root, file)

            # Check if the file matches the filename
            if search_filename and file.startswith(search_filename):
                results.append(file_path)
                continue

            # Check if the file contains the specified content
            if search_content:
                try:
                    with open(file_path, 'r') as f:
                        content = f.read()
                        if search_content in content:
                            results.append(file_path)
                except Exception as e:
                    # Handle any exceptions that occur while reading the file
                    print(f"Error reading file {file_path}: {str(e)}")

    return results

# Define the API endpoint
@app.route('/search', methods=['POST'])
def search():
    """
    API endpoint to search for files in the data directory.

    Request Body:
        search_content (str): The content to search for in the files.
        search_filename (str): The filename to search for.
        search_dir (str): The relative path to search in.

    Returns:
        JSON: A list of complete paths to files that contain the specified content or match the filename.
    """
    # Get the request body
    data = request.get_json()

    # Check if the request body is valid
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    # Get the search parameters
    search_content = data.get('search_content')
    search_filename = data.get('search_filename')
    search_dir = data.get('search_dir', '')

    # Search for files
    results = search_files(search_content, search_filename, search_dir)

    # Return the results
    return jsonify({'files': results})

if __name__ == '__main__':
    # Start the Flask development server
    app.run(host='0.0.0.0', port=5000)