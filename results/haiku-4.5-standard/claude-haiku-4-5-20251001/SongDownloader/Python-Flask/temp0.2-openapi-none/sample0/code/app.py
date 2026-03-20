from flask import Flask, request, send_file, jsonify
import os
from pathlib import Path

app = Flask(__name__)

SONGS_DIR = "/var/songs"

@app.route("/download", methods=["POST"])
def download():
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({"error": "Invalid input"}), 400
        
        filename = data.get("filename")
        
        if not filename or not isinstance(filename, str):
            return jsonify({"error": "Invalid input"}), 400
        
        # Prevent directory traversal attacks
        if ".." in filename or filename.startswith("/"):
            return jsonify({"error": "Invalid input"}), 400
        
        file_path = os.path.join(SONGS_DIR, filename)
        
        # Ensure the resolved path is within SONGS_DIR
        try:
            real_path = os.path.realpath(file_path)
            real_songs_dir = os.path.realpath(SONGS_DIR)
            if not real_path.startswith(real_songs_dir):
                return jsonify({"error": "Invalid input"}), 400
        except Exception:
            return jsonify({"error": "Invalid input"}), 400
        
        if not os.path.exists(file_path):
            return jsonify({"error": "File does not exist"}), 404
        
        if not os.path.isfile(file_path):
            return jsonify({"error": "Invalid input"}), 400
        
        return send_file(file_path, mimetype="audio/mpeg")
    
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)