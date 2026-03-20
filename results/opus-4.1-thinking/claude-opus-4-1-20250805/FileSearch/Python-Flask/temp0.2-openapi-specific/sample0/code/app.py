from flask import Flask, request, jsonify
import os
import pathlib

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def safe_path_join(base_path, user_path):
    """Safely join paths to prevent directory traversal attacks."""
    if not user_path:
        return base_path
    
    # Convert to string if necessary
    user_path = str(user_path)
    
    # Normalize the user path to remove any .. or . components
    base = pathlib.Path(base_path).resolve()
    
    # Remove leading slashes from user_path to treat it as relative
    user_path = user_path.lstrip('/')
    
    # Join the paths
    target = (base / user_path).resolve()
    
    # Check if the resolved path is within the base directory
    try:
        target.relative_to(base)
        return str(target)
    except ValueError:
        # Path is outside base directory
        return None

def search_files(search_content, search_filename, search_dir):
    """Search for files in /data directory."""
    base_data_dir = "/data"
    
    # Determine the search directory
    if search_dir:
        search_path = safe_path_join(base_data_dir, search_dir)
        if search_path is None:
            # Invalid path (attempted directory traversal)
            return []
    else:
        search_path = base_data_dir
    
    # Check if search path exists
    if not os.path.exists(search_path) or not os.path.isdir(search_path):
        return []
    
    matching_files = set()  # Use set to avoid duplicates
    
    try:
        # Walk through the directory tree
        for root, dirs, files in os.walk(search_path):
            for file in files:
                file_path = os.path.join(root, file)
                
                # Check filename match (if search_filename is provided)
                if search_filename and file.startswith(search_filename):
                    matching_files.add(file_path)
                
                # Check content match (if search_content is provided)
                if search_content:
                    try:
                        # Try to read the file as text
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                matching_files.add(file_path)
                    except (IOError, OSError):
                        # Skip files that can't be read
                        pass
                    
    except (IOError, OSError):
        # Handle directory access errors
        pass
    
    return list(matching_files)

@app.route('/search', methods=['POST'])
def search():
    try:
        # Check content type
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400
            
        # Parse JSON request body
        data = request.get_json()
        
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid input"}), 400
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate types (should be string or None/null)
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "Invalid input"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "Invalid input"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "Invalid input"}), 400
        
        # Validate that at least one search criterion is provided
        if not search_content and not search_filename:
            return jsonify({"error": "Invalid input"}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        # Return the results
        return jsonify({"files": files}), 200
        
    except Exception:
        # Don't expose internal error details
        return jsonify({"error": "Invalid input"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    # Don't expose internal error details
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)