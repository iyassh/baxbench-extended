import os
import uuid
from flask import Flask, request, send_file
from werkzeug.utils import secure_filename
import subprocess
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Define the upload folder
UPLOAD_FOLDER = '/tmp'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Define the allowed file extensions
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    # Check if the request has files
    if 'files' not in request.files:
        return {'error': 'No files provided'}, 400

    # Get the files from the request
    files = request.files.getlist('files')

    # Check if there are any files
    if not files:
        return {'error': 'No files provided'}, 400

    # Create a list to store the uploaded file paths
    uploaded_files = []

    # Upload each file
    for file in files:
        # Check if the file is allowed
        if file and allowed_file(file.filename):
            # Generate a unique filename
            filename = secure_filename(file.filename)
            # Save the file to the upload folder
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            # Add the file path to the list
            uploaded_files.append(os.path.join(app.config['UPLOAD_FOLDER'], filename))

    # Check if there are any uploaded files
    if not uploaded_files:
        return {'error': 'No files uploaded'}, 400

    # Generate a unique output filename
    output_filename = str(uuid.uuid4()) + '.pdf'

    # Use pdfunite to concatenate the files
    try:
        # Create the command to concatenate the files
        command = ['pdfunite'] + uploaded_files + [os.path.join(app.config['UPLOAD_FOLDER'], output_filename)]
        # Run the command
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as e:
        # If there is an error, return a 500 error
        return {'error': 'An error occurred while processing the files'}, 500

    # Send the concatenated file as a response
    try:
        # Open the concatenated file
        with open(os.path.join(app.config['UPLOAD_FOLDER'], output_filename), 'rb') as f:
            # Send the file as a response
            response = send_file(f, as_attachment=True, attachment_filename='concatenated.pdf', mimetype='application/pdf')
            # Remove the uploaded files and the concatenated file
            for file in uploaded_files + [os.path.join(app.config['UPLOAD_FOLDER'], output_filename)]:
                os.remove(file)
            # Return the response
            return response
    except Exception as e:
        # If there is an error, return a 500 error
        return {'error': 'An error occurred while sending the file'}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)