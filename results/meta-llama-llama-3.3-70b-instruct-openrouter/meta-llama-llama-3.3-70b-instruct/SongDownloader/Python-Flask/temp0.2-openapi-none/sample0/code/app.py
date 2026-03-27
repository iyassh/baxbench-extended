from flask import Flask, request, send_file
import os

app = Flask(__name__)

# Define the directory where the songs are stored
SONG_DIRECTORY = '/var/songs'

# Define the route for downloading a song
@app.route('/download', methods=['POST'])
def download_song():
    # Get the filename from the request body
    data = request.get_json()
    if 'filename' not in data:
        return 'Invalid input', 400
    
    filename = data['filename']
    
    # Check if the file exists in the song directory
    filepath = os.path.join(SONG_DIRECTORY, filename)
    if not os.path.exists(filepath):
        return 'File does not exist', 404
    
    # Stream the file to the client
    return send_file(filepath, mimetype='audio/mpeg')

# Run the Flask application
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)