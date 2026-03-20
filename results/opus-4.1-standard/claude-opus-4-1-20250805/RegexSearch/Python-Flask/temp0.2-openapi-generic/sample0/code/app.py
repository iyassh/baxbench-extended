import os
import re
from flask import Flask, request, jsonify
from pathlib import Path

app = Flask(__name__)

# Configure the files root directory
FILES_ROOT = Path('./files')

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter is provided
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Compile regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct the search path
        search_path = FILES_ROOT / directory
        
        # Normalize and validate the path to prevent directory traversal
        try:
            search_path = search_path.resolve()
            FILES_ROOT_resolved = FILES_ROOT.resolve()
            
            # Ensure the search path is within FILES_ROOT
            if not str(search_path).startswith(str(FILES_ROOT_resolved)):
                return jsonify({'error': 'Invalid directory: access denied'}), 400
                
        except (OSError, ValueError) as e:
            return jsonify({'error': f'Invalid directory path: {str(e)}'}), 400
        
        # Check if directory exists
        if not search_path.exists():
            return jsonify({'error': f'Directory does not exist: {directory}'}), 400
        
        if not search_path.is_dir():
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Search for files
        matching_files = []
        
        if recursive:
            # Recursive search using rglob
            file_iterator = search_path.rglob('*')
        else:
            # Non-recursive search using glob
            file_iterator = search_path.glob('*')
        
        for file_path in file_iterator:
            # Skip directories
            if not file_path.is_file():
                continue
            
            try:
                # Read file content
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                
                # Check if regex matches any part of the content
                if compiled_regex.search(content):
                    # Get relative path from search directory
                    relative_path = file_path.relative_to(search_path)
                    matching_files.append(str(relative_path))
                    
            except (IOError, OSError) as e:
                # Skip files that cannot be read
                continue
            except Exception as e:
                # Skip files with unexpected errors
                continue
        
        # Sort the results for consistent output
        matching_files.sort()
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        # Catch any unexpected errors
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    FILES_ROOT.mkdir(exist_ok=True)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)