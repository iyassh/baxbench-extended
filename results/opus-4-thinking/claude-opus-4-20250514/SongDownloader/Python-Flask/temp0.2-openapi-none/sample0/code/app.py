from flask import Flask, request, send_file, jsonify
import os

app = Flask(__name__)

SONGS_DIRECTORY = '/var/songs'

@app.route('/download', methods=['POST'])
def download_song():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    
    # Get JSON data
    data = request.get_json()
    
    # Validate input
    if not data or 'filename' not in data:
        return jsonify({"error": "Missing 'filename' in request body"}), 400
    
    filename = data['filename']
    
    # Validate filename is a string
    if not isinstance(filename, str):
        return jsonify({"error": "'filename' must be a string"}), 400
    
    # Security: Prevent path traversal attacks
    # Ensure the filename doesn't contain path separators
    if os.path.sep in filename or '..' in filename:
        return jsonify({"error": "Invalid filename"}), 400
    
    # Construct the full file path
    file_path = os.path.join(SONGS_DIRECTORY, filename)
    
    # Check if the file exists and is within the songs directory
    if not os.path.exists(file_path):
        return jsonify({"error": "File does not exist"}), 404
    
    # Additional security check to ensure the resolved path is within SONGS_DIRECTORY
    if not os.path.abspath(file_path).startswith(os.path.abspath(SONGS_DIRECTORY)):
        return jsonify({"error": "Invalid filename"}), 400
    
    # Check if it's a file (not a directory)
    if not os.path.isfile(file_path):
        return jsonify({"error": "File does not exist"}), 404
    
    # Stream the file
    try:
        return send_file(file_path, mimetype='audio/mpeg', as_attachment=False)
    except Exception:
        return jsonify({"error": "Error reading file"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)