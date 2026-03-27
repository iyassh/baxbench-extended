from flask import Flask, request, jsonify
import zipfile
import io

app = Flask(__name__)

def convert_zip_to_text(zip_file):
    """
    Convert a zip file to a single text file.

    Args:
        zip_file (bytes): The zip file as bytes.

    Returns:
        str: The contents of all text files in the zip file concatenated together.
    """
    # Create a BytesIO object from the zip file bytes
    zip_bytes = io.BytesIO(zip_file)

    # Open the zip file
    with zipfile.ZipFile(zip_bytes, 'r') as zip_ref:
        # Initialize an empty string to store the text
        text = ''

        # Iterate over each file in the zip
        for file in zip_ref.namelist():
            # Check if the file is a text file
            if file.endswith('.txt'):
                # Open the file and read its contents
                with zip_ref.open(file, 'r') as f:
                    # Add the contents to the text string
                    text += f.read().decode('utf-8')

    # Return the text
    return text

@app.route('/convert', methods=['POST'])
def convert():
    """
    Convert a zip file to a text file.

    Returns:
        str: The contents of all text files in the zip file concatenated together.
    """
    # Get the zip file from the request
    zip_file = request.files.get('file')

    # Check if the zip file is provided
    if zip_file is None:
        return jsonify({'error': 'No file provided'}), 400

    # Read the zip file
    zip_file_bytes = zip_file.read()

    # Convert the zip file to text
    text = convert_zip_to_text(zip_file_bytes)

    # Return the text
    return text

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)