import os
import json
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security: Define the base data directory
BASE_DATA_DIR = Path("/data").resolve()


def is_safe_path(base_dir, target_path):
    """
    Verify that target_path is within base_dir to prevent directory traversal attacks (CWE-22).
    """
    try:
        base = base_dir.resolve()
        target = (base_dir / target_path).resolve()
        return target.is_relative_to(base)
    except (ValueError, RuntimeError):
        return False


def search_files(search_dir, search_content, search_filename):
    """
    Search for files in the specified directory that match the criteria.
    Returns a list of absolute paths to matching files.
    """
    results = []
    
    # Determine the search directory
    if search_dir:
        search_path = BASE_DATA_DIR / search_dir.lstrip("/")
    else:
        search_path = BASE_DATA_DIR
    
    # Security: Validate the search path (CWE-22)
    if not is_safe_path(BASE_DATA_DIR, search_path.relative_to(BASE_DATA_DIR) if search_path.is_relative_to(BASE_DATA_DIR) else search_dir or ""):
        return results
    
    # Check if the search directory exists
    if not search_path.exists() or not search_path.is_dir():
        return results
    
    try:
        # Walk through the directory
        for root, dirs, files in os.walk(search_path):
            root_path = Path(root)
            
            # Security: Verify each directory is within BASE_DATA_DIR
            if not is_safe_path(BASE_DATA_DIR, root_path.relative_to(BASE_DATA_DIR)):
                continue
            
            for file in files:
                file_path = root_path / file
                
                # Security: Verify file is within BASE_DATA_DIR
                if not is_safe_path(BASE_DATA_DIR, file_path.relative_to(BASE_DATA_DIR)):
                    continue
                
                match = False
                
                # Check filename match
                if search_filename:
                    if file.startswith(search_filename):
                        match = True
                
                # Check content match
                if search_content and not match:
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except (IOError, OSError):
                        # Security: Don't expose file access errors (CWE-209)
                        pass
                
                if match:
                    results.append(str(file_path))
    
    except (OSError, IOError):
        # Security: Don't expose directory traversal errors (CWE-209, CWE-703)
        pass
    
    return results


@app.before_request
def add_security_headers():
    """Add security headers to all responses (CWE-693)."""
    pass


@app.after_request
def add_security_headers_response(response):
    """Add security headers to responses (CWE-693)."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


@app.route("/search", methods=["POST"])
def search():
    """
    Search for files in the /data directory.
    
    Request body:
    {
        "search_content": "string or null",
        "search_filename": "string or null",
        "search_dir": "string or null"
    }
    
    Returns:
    {
        "files": ["path1", "path2", ...]
    }
    """
    try:
        # Parse JSON request
        data = request.get_json(force=True, silent=False)
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Extract parameters
        search_content = data.get("search_content")
        search_filename = data.get("search_filename")
        search_dir = data.get("search_dir")
        
        # Validate input types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "Invalid input"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "Invalid input"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "Invalid input"}), 400
        
        # At least one search parameter must be provided
        if not search_content and not search_filename:
            return jsonify({"error": "Invalid input"}), 400
        
        # Perform the search
        files = search_files(search_dir, search_content, search_filename)
        
        return jsonify({"files": files}), 200
    
    except (ValueError, TypeError, json.JSONDecodeError):
        # Security: Don't expose detailed error messages (CWE-209, CWE-703)
        return jsonify({"error": "Invalid input"}), 400
    except Exception:
        # Security: Don't expose internal errors (CWE-209, CWE-703)
        return jsonify({"error": "Invalid input"}), 400


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing sensitive information (CWE-209)."""
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors without exposing sensitive information (CWE-209)."""
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information (CWE-209)."""
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    # Ensure the base data directory exists
    BASE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Run the Flask app
    app.run(host="0.0.0.0", port=5000, debug=False)