from flask import Flask, request, jsonify
import re
import os
from pathlib import Path

app = Flask(__name__)

# Define the files root directory
FILES_ROOT = Path('./files').resolve()


def is_safe_path(basedir, path):
    """
    Check if a path is safe and within the base directory.
    Prevents directory traversal attacks.
    """
    try:
        basedir = Path(basedir).resolve()
        path = Path(path).resolve()
        # Check if path starts with basedir by attempting to get relative path
        try:
            path.relative_to(basedir)
            return True
        except ValueError:
            return False
    except (ValueError, RuntimeError, OSError):
        return False


def search_files(regex_pattern, search_dir, recursive=False):
    """
    Search files in the given directory for content matching the regex pattern.
    
    Args:
        regex_pattern: Compiled regex pattern
        search_dir: Path object for the directory to search
        recursive: Whether to search recursively
    
    Returns:
        List of file paths relative to search_dir that match the regex
    """
    matching_files = []
    
    try:
        if recursive:
            # Recursively search all files
            for root, dirs, files in os.walk(search_dir):
                for filename in files:
                    filepath = Path(root) / filename
                    # Ensure we're still within the safe directory
                    if not is_safe_path(search_dir, filepath):
                        continue
                    try:
                        # Read file content and check against regex
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            # Read up to 1MB to avoid memory issues
                            content = f.read(1024 * 1024)
                            if regex_pattern.search(content):
                                # Get relative path from search_dir
                                rel_path = filepath.relative_to(search_dir)
                                # Use forward slashes for consistency
                                matching_files.append(str(rel_path).replace('\\', '/'))
                    except (IOError, OSError, UnicodeDecodeError):
                        # Skip files that can't be read
                        continue
        else:
            # Search only in the specified directory (non-recursive)
            if search_dir.is_dir():
                for item in search_dir.iterdir():
                    if item.is_file():
                        try:
                            with open(item, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read(1024 * 1024)
                                if regex_pattern.search(content):
                                    matching_files.append(item.name)
                        except (IOError, OSError, UnicodeDecodeError):
                            continue
    except Exception as e:
        raise Exception(f"Error searching files: {str(e)}")
    
    return matching_files


@app.route('/search', methods=['GET'])
def search():
    """
    Search files by regex pattern.
    
    Query parameters:
        regex: The regex pattern to match (required)
        directory: Directory path relative to files root (optional)
        recursive: Whether to search recursively (optional, default: false)
    
    Returns:
        JSON response with list of matching files or error message
    """
    try:
        # Get query parameters
        regex_str = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive_str = request.args.get('recursive', 'false').lower()
        
        # Validate regex parameter
        if not regex_str:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Parse recursive parameter
        recursive = recursive_str in ['true', '1', 'yes']
        
        # Compile regex pattern
        try:
            regex_pattern = re.compile(regex_str)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct search directory path
        if directory:
            # Normalize the directory path and remove leading/trailing slashes
            directory = directory.strip().strip('/')
            search_dir = (FILES_ROOT / directory).resolve()
        else:
            search_dir = FILES_ROOT
        
        # Ensure the search directory is within FILES_ROOT (prevent directory traversal)
        if not is_safe_path(FILES_ROOT, search_dir):
            return jsonify({'error': 'Invalid directory path: access denied'}), 400
        
        # Check if search directory exists
        if not search_dir.exists():
            return jsonify({'error': 'Directory not found'}), 400
        
        if not search_dir.is_dir():
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # Search files
        matching_files = search_files(regex_pattern, search_dir, recursive)
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Create files directory if it doesn't exist
    FILES_ROOT.mkdir(exist_ok=True)
    
    # Start the Flask server
    app.run(host='0.0.0.0', port=5000, debug=False)