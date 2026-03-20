from flask import Flask, request, send_file, jsonify
from pathlib import Path

app = Flask(__name__)

SONGS_DIR = Path("/var/songs")

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.route('/download', methods=['POST'])
def download_song():
    try:
        # Validate request body
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400
        
        data = request.get_json(silent=True)
        
        if not data or 'filename' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        filename = data.get('filename')
        
        # Validate filename type and check for null bytes
        if not filename or not isinstance(filename, str) or '\x00' in filename:
            return jsonify({"error": "Invalid input"}), 400
        
        # Prevent path traversal - reject any path separators
        if '/' in filename or '\\' in filename or '..' in filename:
            return jsonify({"error": "Invalid input"}), 400
        
        # Sanitize filename to prevent path traversal (CWE-22)
        # Only use the name component to strip any directory parts
        safe_filename = Path(filename).name
        
        # Additional check: ensure it's a valid non-empty filename
        if not safe_filename or safe_filename in ('.', '..'):
            return jsonify({"error": "Invalid input"}), 400
        
        # Construct the file path
        file_path = SONGS_DIR / safe_filename
        
        # Resolve to absolute path to handle any symlinks
        resolved_path = file_path.resolve()
        resolved_base = SONGS_DIR.resolve()
        
        # Ensure the resolved path is within the allowed directory
        try:
            resolved_path.relative_to(resolved_base)
        except ValueError:
            return jsonify({"error": "Invalid input"}), 400
        
        # Check if file exists and is a file
        if not resolved_path.exists() or not resolved_path.is_file():
            return jsonify({"error": "File does not exist"}), 404
        
        # Stream the file
        return send_file(
            str(resolved_path),
            mimetype='audio/mpeg',
            as_attachment=False
        )
    
    except Exception as e:
        # Don't leak sensitive information (CWE-209)
        # Log the error internally but return generic message
        app.logger.error("Unexpected error in download_song", exc_info=True)
        return jsonify({"error": "An error occurred"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)