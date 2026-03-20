import os
import re
import json
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configuration
FILES_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files')

# Ensure files root directory exists
os.makedirs(FILES_ROOT, exist_ok=True)


def is_safe_path(base_path, user_path):
    """
    Verify that the resolved path is within the base path to prevent directory traversal.
    """
    base = Path(base_path).resolve()
    target = (base / user_path).resolve()
    
    try:
        target.relative_to(base)
        return True
    except ValueError:
        return False


def search_files(directory, regex_pattern, recursive):
    """
    Search files in the specified directory for content matching the regex pattern.
    
    Args:
        directory: Directory path relative to FILES_ROOT
        regex_pattern: Regex pattern to match
        recursive: Whether to search recursively
    
    Returns:
        List of matching file paths relative to the search directory
    """
    # Validate and construct the search path
    if directory:
        search_path = os.path.join(FILES_ROOT, directory)
    else:
        search_path = FILES_ROOT
    
    # Security check: ensure the path is within FILES_ROOT
    if not is_safe_path(FILES_ROOT, directory or '.'):
        raise ValueError("Invalid directory path")
    
    # Check if directory exists
    if not os.path.isdir(search_path):
        raise ValueError(f"Directory not found: {directory}")
    
    # Compile regex pattern
    try:
        compiled_regex = re.compile(regex_pattern)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    matching_files = []
    
    # Search files
    if recursive:
        for root, dirs, files in os.walk(search_path):
            for filename in files:
                file_path = os.path.join(root, filename)
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if compiled_regex.search(content):
                            # Calculate relative path from search_path
                            rel_path = os.path.relpath(file_path, search_path)
                            matching_files.append(rel_path)
                except (IOError, OSError):
                    # Skip files that cannot be read
                    continue
    else:
        # Non-recursive search
        try:
            entries = os.listdir(search_path)
        except (IOError, OSError) as e:
            raise ValueError(f"Cannot access directory: {str(e)}")
        
        for entry in entries:
            file_path = os.path.join(search_path, entry)
            if os.path.isfile(file_path):
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if compiled_regex.search(content):
                            matching_files.append(entry)
                except (IOError, OSError):
                    # Skip files that cannot be read
                    continue
    
    return matching_files


@app.route('/search', methods=['GET'])
def search():
    """
    Search files by regex pattern.
    """
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_str = request.args.get('recursive', 'false').lower()
        
        # Validate required parameters
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Parse recursive parameter
        recursive = recursive_str in ('true', '1', 'yes')
        
        # Perform search
        matching_files = search_files(directory, regex_pattern, recursive)
        
        return jsonify({'files': matching_files}), 200
    
    except ValueError as e:
        # Handle validation errors (invalid regex, invalid directory, etc.)
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        # Handle unexpected errors
        return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)