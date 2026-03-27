import os
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Define the root directory for files
FILES_ROOT = './files'

# Define a function to search files based on regex
def search_files(regex, directory, recursive):
    """
    Searches files in a specified directory and returns files whose content matches the given regex.

    Args:
        regex (str): The regex pattern to match partially against file contents.
        directory (str): The directory path to search files in, relative to the files root directory.
        recursive (bool): Whether to search recursively in subdirectories.

    Returns:
        list: A list of file paths relative to the search directory that match the regex.
    """
    try:
        # Compile the regex pattern
        pattern = re.compile(regex)
    except re.error as e:
        # Return an error if the regex pattern is malformed
        return None, str(e)

    # Initialize the list of matching files
    matching_files = []

    # Construct the absolute path of the search directory
    search_dir = os.path.join(FILES_ROOT, directory) if directory else FILES_ROOT

    # Check if the search directory exists
    if not os.path.exists(search_dir):
        # Return an error if the search directory does not exist
        return None, f"Directory '{search_dir}' does not exist"

    # Iterate over files in the search directory
    for root, dirs, files in os.walk(search_dir):
        for file in files:
            # Construct the absolute path of the file
            file_path = os.path.join(root, file)

            try:
                # Read the content of the file
                with open(file_path, 'r') as f:
                    content = f.read()

                # Check if the file content matches the regex pattern
                if pattern.search(content):
                    # Calculate the relative path of the file to the search directory
                    relative_path = os.path.relpath(file_path, search_dir)

                    # Add the relative path to the list of matching files
                    matching_files.append(relative_path)
            except Exception as e:
                # Log any errors that occur while reading or processing the file
                print(f"Error processing file '{file_path}': {str(e)}")

        # If recursive search is not enabled, break after the first iteration
        if not recursive:
            break

    # Return the list of matching files
    return matching_files, None

# Define the API endpoint for searching files
@app.route('/search', methods=['GET'])
def search_files_endpoint():
    """
    API endpoint for searching files based on regex.

    Returns:
        JSON response with a list of file paths that match the regex, or an error message.
    """
    # Get the regex pattern, directory, and recursive search flag from the query parameters
    regex = request.args.get('regex')
    directory = request.args.get('directory')
    recursive = request.args.get('recursive', default=False, type=lambda x: (x.lower() == 'true'))

    # Check if the regex pattern is provided
    if not regex:
        # Return an error if the regex pattern is not provided
        return jsonify({'error': 'Regex pattern is required'}), 400

    # Search files based on the regex pattern
    matching_files, error = search_files(regex, directory, recursive)

    # Return the list of matching files or an error message
    if error:
        return jsonify({'error': error}), 400
    else:
        return jsonify({'files': matching_files}), 200

# Define a custom error handler for internal server errors
@app.errorhandler(500)
def internal_server_error(e):
    """
    Custom error handler for internal server errors.

    Returns:
        JSON response with an error message.
    """
    return jsonify({'error': 'Internal server error'}), 500

# Run the Flask application
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)