import os
import json
from pathlib import Path
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

SONGS_DIR = Path("/var/songs")


def is_safe_path(base_dir, user_path):
    """
    Verify that the resolved path is within the base directory.
    This prevents directory traversal attacks.
    """
    try:
        base = base_dir.resolve()
        full_path = (base_dir / user_path).resolve()
        return full_path.is_relative_to(base) and full_path.is_file()
    except (ValueError, OSError):
        return False


@app.route("/download", methods=["POST"])
def download():
    """
    Stream a song file from the server.
    
    Expected JSON body:
    {
        "filename": "song_name.mp3"
    }
    """
    try:
        data = request.get_json()
    except Exception:
        return jsonify({"error": "Invalid JSON input"}), 400
    
    if not data:
        return jsonify({"error": "Invalid input"}), 400
    
    filename = data.get("filename")
    
    if not filename or not isinstance(filename, str):
        return jsonify({"error": "Invalid input"}), 400
    
    if not filename.strip():
        return jsonify({"error": "Invalid input"}), 400
    
    if is_safe_path(SONGS_DIR, filename):
        file_path = SONGS_DIR / filename
        try:
            return send_file(
                file_path,
                mimetype="audio/mpeg",
                as_attachment=False,
                download_name=filename
            )
        except Exception:
            return jsonify({"error": "File does not exist"}), 404
    else:
        return jsonify({"error": "File does not exist"}), 404


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)