import zipfile
import io
from flask import Flask, request, Response
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Common text file extensions
TEXT_EXTENSIONS = {
    '.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.xml',
    '.yaml', '.yml', '.csv', '.log', '.sh', '.bash', '.java', '.cpp',
    '.c', '.h', '.sql', '.r', '.rb', '.go', '.rs', '.ts', '.jsx',
    '.tsx', '.vue', '.php', '.pl', '.scala', '.kotlin', '.swift',
    '.m', '.mm', '.groovy', '.gradle', '.maven', '.sbt', '.clj',
    '.cljs', '.edn', '.ex', '.exs', '.erl', '.hrl', '.fs', '.fsx',
    '.fsi', '.ml', '.mli', '.pas', '.pp', '.lua', '.vim', '.emacs',
    '.lisp', '.scm', '.asm', '.s', '.tex', '.latex', '.rst', '.adoc',
    '.asciidoc', '.org', '.wiki', '.conf', '.config', '.cfg', '.ini',
    '.toml', '.properties', '.gradle', '.maven', '.sbt', '.dockerfile',
    '.gitignore', '.gitattributes', '.editorconfig', '.env', '.envrc'
}


def is_text_file(filename):
    """Check if a file should be treated as text based on extension."""
    if not filename:
        return False
    
    # Get the file extension
    ext = '.' + filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    
    # Check against known text extensions
    if ext in TEXT_EXTENSIONS:
        return True
    
    # Files without extension might be text (like Dockerfile, Makefile, etc.)
    if not ext or ext == '.':
        return True
    
    return False


def extract_text_from_zip(zip_file):
    """Extract text content from all text files in a zip file."""
    try:
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            text_contents = []
            
            for file_info in zip_ref.filelist:
                # Skip directories
                if file_info.filename.endswith('/'):
                    continue
                
                # Check if it's a text file
                if is_text_file(file_info.filename):
                    try:
                        # Read the file content
                        content = zip_ref.read(file_info.filename)
                        
                        # Try to decode as text
                        try:
                            text = content.decode('utf-8')
                        except UnicodeDecodeError:
                            # Try other common encodings
                            try:
                                text = content.decode('latin-1')
                            except UnicodeDecodeError:
                                text = content.decode('utf-8', errors='replace')
                        
                        # Add file header and content
                        text_contents.append(f"=== {file_info.filename} ===\n")
                        text_contents.append(text)
                        text_contents.append("\n\n")
                    except Exception as e:
                        # Skip files that can't be read
                        continue
            
            return ''.join(text_contents)
    except zipfile.BadZipFile:
        raise ValueError("Invalid zip file")
    except Exception as e:
        raise ValueError(f"Error processing zip file: {str(e)}")


@app.route('/convert', methods=['POST'])
def convert():
    """Convert a zip file to a text file."""
    # Check if file is present in request
    if 'file' not in request.files:
        return Response(
            "No file provided",
            status=400,
            mimetype='text/plain'
        )
    
    file = request.files['file']
    
    # Check if file is empty
    if file.filename == '':
        return Response(
            "No file selected",
            status=400,
            mimetype='text/plain'
        )
    
    # Validate file is a zip file
    if not file.filename.lower().endswith('.zip'):
        return Response(
            "File must be a zip file",
            status=400,
            mimetype='text/plain'
        )
    
    try:
        # Read file into memory
        file_content = file.read()
        
        # Check if file is empty
        if not file_content:
            return Response(
                "File is empty",
                status=400,
                mimetype='text/plain'
            )
        
        # Create a BytesIO object from the file content
        zip_buffer = io.BytesIO(file_content)
        
        # Extract text from zip
        result_text = extract_text_from_zip(zip_buffer)
        
        # Return the result as plain text
        return Response(
            result_text,
            status=200,
            mimetype='text/plain'
        )
    
    except ValueError as e:
        return Response(
            str(e),
            status=400,
            mimetype='text/plain'
        )
    except Exception as e:
        return Response(
            f"Error processing file: {str(e)}",
            status=400,
            mimetype='text/plain'
        )


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return Response("OK", status=200, mimetype='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)