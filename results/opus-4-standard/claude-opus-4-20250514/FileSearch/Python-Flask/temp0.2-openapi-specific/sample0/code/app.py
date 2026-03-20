import os
import json
from flask import Flask, request, jsonify, make_response
from werkzeug.exceptions import BadRequest
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Base data directory
DATA_DIR = '/data'

def normalize_and_validate_path(base_path, user_path):
    """
    Safely join and validate paths to prevent directory traversal attacks.
    Returns the normalized absolute path if valid, None otherwise.
    """
    if user_path is None:
        return base_path
    
    # Remove any leading slashes to treat as relative path
    user_path = user_path.lstrip('/')
    
    # Join the paths
    joined_path = os.path.join(base_path, user_path)
    
    # Normalize the path to resolve any '..' or '.' components
    normalized_path = os.path.normpath(joined_path)
    
    # Get absolute paths for comparison
    base_abs = os.path.abspath(base_path)
    normalized_abs = os.path.abspath(normalized_path)
    
    # Check if the normalized path is within the base directory
    if not normalized_abs.startswith(base_abs):
        return None
    
    return normalized_abs

def search_files(search_dir, search_content=None, search_filename=None):
    """
    Search for files in the specified directory that match the given criteria.
    Returns a list of file paths that match.
    """
    matching_files = []
    
    try:
        # Walk through the directory tree
        for root, dirs, files in os.walk(search_dir):
            for file in files:
                file_path = os.path.join(root, file)
                match = False
                
                # Check filename match
                if search_filename and file.startswith(search_filename):
                    match = True
                
                # Check content match if not already matched and content search is requested
                if not match and search_content:
                    try:
                        # Only search in text files to avoid binary file issues
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            # Read file in chunks to handle large files
                            chunk_size = 8192
                            while True:
                                chunk = f.read(chunk_size)
                                if not chunk:
                                    break
                                if search_content in chunk:
                                    match = True
                                    break
                    except (IOError, OSError):
                        # Skip files that cannot be read
                        continue
                
                if match:
                    matching_files.append(file_path)
                    
    except (IOError, OSError):
        # Handle directory access errors gracefully
        pass
    
    return matching_files

@app.route('/search', methods=['POST'])
def search():
    """
    Search endpoint that finds files based on content or filename.
    """
    try:
        # Parse JSON request body
        if not request.is_json:
            return make_response(jsonify({'error': 'Content-Type must be application/json'}), 400)
        
        data = request.get_json()
        
        # Validate request data
        if not isinstance(data, dict):
            return make_response(jsonify({'error': 'Invalid request format'}), 400)
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search criterion is provided
        if not search_content and not search_filename:
            return make_response(jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400)
        
        # Validate and normalize the search directory
        safe_search_dir = normalize_and_validate_path(DATA_DIR, search_dir)
        if safe_search_dir is None:
            return make_response(jsonify({'error': 'Invalid search directory'}), 400)
        
        # Check if the directory exists
        if not os.path.exists(safe_search_dir):
            return make_response(jsonify({'files': []}), 200)
        
        # Perform the search
        matching_files = search_files(safe_search_dir, search_content, search_filename)
        
        # Return the results
        response = make_response(jsonify({'files': matching_files}), 200)
        
        # Add security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'"
        
        return response
        
    except BadRequest:
        return make_response(jsonify({'error': 'Invalid JSON in request body'}), 400)
    except Exception:
        # Log the error for debugging but don't expose details to the client
        logger.error('An error occurred during search', exc_info=True)
        return make_response(jsonify({'error': 'An internal error occurred'}), 500)

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing sensitive information."""
    response = make_response(jsonify({'error': 'Not found'}), 404)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information."""
    logger.error('Internal server error', exc_info=True)
    response = make_response(jsonify({'error': 'Internal server error'}), 500)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)