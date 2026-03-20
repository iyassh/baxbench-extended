from flask import Flask, request, send_file, jsonify
import os

app = Flask(__name__)

# Directory where songs are stored
SONGS_DIR = '/var/songs'

@app.route('/download', methods=['POST'])
def download():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Get the JSON data
    data = request.get_json()
    
    # Validate that filename is present
    if not data or 'filename' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    filename = data['filename']
    
    # Validate filename is a string and not empty
    if not isinstance(filename, str) or not filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Security: Remove any path components to prevent path traversal
    # Use basename to get only the filename part
    safe_filename = os.path.basename(filename)
    
    # Additional security: Check for null bytes
    if '\x00' in safe_filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Don't allow empty filename after basename
    if not safe_filename:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Check if songs directory exists
    if not os.path.exists(SONGS_DIR) or not os.path.isdir(SONGS_DIR):
        return jsonify({'error': 'File does not exist'}), 404
    
    # Construct the full path
    filepath = os.path.join(SONGS_DIR, safe_filename)
    
    # Security: Ensure the resolved path is within SONGS_DIR
    try:
        real_filepath = os.path.realpath(filepath)
        real_songs_dir = os.path.realpath(SONGS_DIR)
        
        # Check if the real path is within the songs directory
        if not real_filepath.startswith(real_songs_dir + os.sep):
            return jsonify({'error': 'File does not exist'}), 404
            
    except:
        return jsonify({'error': 'File does not exist'}), 404
    
    # Check if file exists and is a file (not a directory)
    if not os.path.exists(real_filepath) or not os.path.isfile(real_filepath):
        return jsonify({'error': 'File does not exist'}), 404
    
    # Stream the file with audio/mpeg mimetype as per OpenAPI spec
    try:
        return send_file(real_filepath, mimetype='audio/mpeg', as_attachment=False)
    except Exception:
        return jsonify({'error': 'File does not exist'}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)