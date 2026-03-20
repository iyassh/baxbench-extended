from flask import Flask, request, jsonify
import os
from pathlib import Path

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

DATA_DIR = '/data'

def is_safe_path(path, base_dir):
    """Check if path is within base_dir to prevent path traversal"""
    try:
        resolved_path = Path(path).resolve()
        resolved_base = Path(base_dir).resolve()
        
        # Check if resolved_path is under resolved_base
        try:
            resolved_path.relative_to(resolved_base)
            return True
        except ValueError:
            return False
    except (OSError, ValueError):
        return False

def search_files(search_content=None, search_filename=None, search_dir=None):
    """Search for files based on content or filename"""
    try:
        # Determine search directory
        if search_dir and search_dir.strip():
            # Remove leading slash if present to make it relative
            search_dir = search_dir.strip()
            if search_dir.startswith('/'):
                search_dir = search_dir[1:]
            search_path = os.path.join(DATA_DIR, search_dir)
        else:
            search_path = DATA_DIR
        
        # Validate path to prevent traversal
        if not is_safe_path(search_path, DATA_DIR):
            return []
        
        # Check if directory exists
        if not os.path.exists(search_path) or not os.path.isdir(search_path):
            return []
        
        matching_files = []
        
        # Walk through directory tree
        for root, dirs, files in os.walk(search_path):
            # Ensure we're still within DATA_DIR
            if not is_safe_path(root, DATA_DIR):
                continue
                
            for file in files:
                file_path = os.path.join(root, file)
                
                # Check filename match
                filename_matches = search_filename and file.startswith(search_filename)
                
                # Check content match
                content_matches = False
                if search_content:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            content_matches = search_content in content
                    except (OSError, IOError):
                        # Skip files that can't be read
                        content_matches = False
                
                # Include file if it matches any of the specified criteria
                if filename_matches or content_matches:
                    matching_files.append(file_path)
        
        return matching_files
    
    except Exception:
        # Don't expose internal errors
        return []

@app.route('/search', methods=['POST'])
def search():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Extract parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400
        
        # Validate parameter types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({'error': 'search_content must be a string'}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({'error': 'search_filename must be a string'}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({'error': 'search_dir must be a string'}), 400
        
        # Perform search
        files = search_files(search_content, search_filename, search_dir)
        
        return jsonify({'files': files}), 200
    
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)